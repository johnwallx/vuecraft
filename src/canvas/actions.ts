// Selection-based editing commands shared by the toolbar and keyboard shortcuts.
import { useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import { useReactFlow, type XYPosition } from '@xyflow/react';
import { isGroup, type DocEdge, type DocNode, type Layer, type Op, type Snapshot } from '../bridge/api';
import { cannotCreateOn } from '../state/editor';
import type { MapNode, LinkEdge } from './flow';

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 56;
const PASTE_OFFSET = 24;

export const newId = () => crypto.randomUUID();

export const newEdge = (source: string, target: string, layer: string): DocEdge => ({
  id: newId(),
  source,
  target,
  label: '',
  layer,
  style: { arrow: 'end', curve: 'straight' },
});

interface Clip {
  nodes: DocNode[];
  edges: DocEdge[];
}

/**
 * Copies of `clip` with fresh ids, offset, and connections remapped to the copies.
 * Group membership is kept when the group is copied too; groups come first so
 * they exist before their members are added.
 */
export function cloneWithNewIds(clip: Clip, offset: number, layer?: string): { nodes: DocNode[]; edges: DocEdge[] } {
  const ids = new Map(clip.nodes.map((n) => [n.id, newId()]));
  const ordered = [...clip.nodes.filter(isGroup), ...clip.nodes.filter((n) => !isGroup(n))];
  return {
    nodes: ordered.map(({ parent, ...n }) => ({
      ...n,
      ...(parent && ids.has(parent) ? { parent: ids.get(parent) } : {}),
      ...(layer ? { layer } : {}),
      id: ids.get(n.id)!,
      x: n.x + offset,
      y: n.y + offset,
    })),
    edges: clip.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, ...(layer ? { layer } : {}), id: newId(), source: ids.get(e.source)!, target: ids.get(e.target)! })),
  };
}

export function useEditActions(
  commit: (label: string, ops: Op[]) => Promise<Snapshot | null>,
  setEditingId: (id: string | null) => void,
  pendingSelection: MutableRefObject<Set<string> | null>,
  notify: (message: string) => void,
  activeLayer: Layer | undefined,
  images: string[] | undefined,
) {
  const rf = useReactFlow<MapNode, LinkEdge>();
  const clipboard = useRef<Clip | null>(null);
  const pastes = useRef(0);

  const selection = useCallback(() => {
    const nodes = rf.getNodes().filter((n) => n.selected);
    const edges = rf.getEdges().filter((e) => e.selected);
    return { nodes, edges };
  }, [rf]);

  const selectionClip = useCallback((): Clip | null => {
    const picked = selection().nodes;
    if (!picked.length) return null;
    // A selected group brings its members along.
    const groups = new Set(picked.filter((n) => n.type === 'mapgroup').map((n) => n.id));
    const nodes = rf.getNodes().filter((n) => n.selected || (n.parentId && groups.has(n.parentId)));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = rf.getEdges().filter((e) => ids.has(e.source) && ids.has(e.target) && e.data);
    return { nodes: nodes.map((n) => n.data.node), edges: edges.map((e) => e.data!.edge) };
  }, [rf, selection]);

  const insert = useCallback(
    async (label: string, clip: Clip, offset: number) => {
      const blocked = cannotCreateOn(activeLayer);
      if (blocked) return notify(blocked);
      // Pasted and duplicated content goes to the active layer, like any new content.
      const { nodes: copies, edges } = cloneWithNewIds(clip, offset, activeLayer!.id);
      // An image copied from another document is not in this one; keep the node without it.
      const held = new Set(images);
      const nodes = copies.map((n) => (n.image && !held.has(n.image) ? { ...n, image: undefined } : n));
      pendingSelection.current = new Set([...nodes, ...edges].map((o) => o.id));
      await commit(label, [
        ...nodes.map((node): Op => ({ op: 'addNode', node })),
        ...edges.map((edge): Op => ({ op: 'addEdge', edge })),
      ]);
    },
    [activeLayer, commit, images, notify, pendingSelection],
  );

  return useMemo(() => {
    const createNodeAt = async (p: XYPosition) => {
      const blocked = cannotCreateOn(activeLayer);
      if (blocked) return notify(blocked);
      const node: DocNode = {
        id: newId(),
        label: 'New concept',
        x: Math.round(p.x - NODE_WIDTH / 2),
        y: Math.round(p.y - NODE_HEIGHT / 2),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        layer: activeLayer!.id,
        style: { shape: 'rounded' },
      };
      pendingSelection.current = new Set([node.id]);
      if (await commit('Create node', [{ op: 'addNode', node }])) setEditingId(node.id);
    };

    return {
      createNodeAt,
      addNodeAtCenter: () => {
        const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
        if (!pane) return;
        const jitter = (rf.getNodes().length % 6) * 12;
        void createNodeAt(rf.screenToFlowPosition({ x: pane.x + pane.width / 2 + jitter, y: pane.y + pane.height / 2 + jitter }));
      },
      deleteSelection: () => {
        const { nodes, edges } = selection();
        void commit('Delete', [
          ...edges.map((e): Op => ({ op: 'removeEdge', id: e.id })),
          ...nodes.map((n): Op => ({ op: 'removeNode', id: n.id })),
        ]);
      },
      copy: () => {
        const clip = selectionClip();
        if (clip) {
          clipboard.current = clip;
          pastes.current = 0;
        }
      },
      paste: () => {
        if (!clipboard.current) return;
        pastes.current += 1;
        void insert('Paste', clipboard.current, PASTE_OFFSET * pastes.current);
      },
      duplicate: () => {
        const clip = selectionClip();
        if (clip) void insert('Duplicate', clip, PASTE_OFFSET);
      },
      groupSelection: () => {
        const { nodes } = selection();
        if (nodes.length < 2) return notify('Select two or more nodes to group them.');
        if (nodes.some((n) => isGroup(n.data.node) || n.data.node.parent)) {
          return notify('Groups cannot be nested. Leave groups and grouped nodes out of the selection, or ungroup them first.');
        }
        // Members share their group's layer: nodes from other layers join the first node's layer.
        const layer = nodes[0].data.node.layer;
        const group: DocNode = { id: newId(), kind: 'group', label: 'Group', x: 0, y: 0, width: 100, height: 100, layer, style: { shape: 'rounded' } };
        pendingSelection.current = new Set([group.id]);
        void commit('Group', [
          ...nodes.filter((n) => n.data.node.layer !== layer).map((n): Op => ({ op: 'setLayer', id: n.id, layer })),
          { op: 'group', group, children: nodes.map((n) => n.id) },
        ]);
      },
      ungroupSelection: () => {
        const picked = selection().nodes;
        const groups = new Set(picked.flatMap((n) => (n.type === 'mapgroup' ? [n.id] : n.parentId ? [n.parentId] : [])));
        if (!groups.size) return notify('Select a group (or a node inside one) to ungroup it.');
        pendingSelection.current = new Set(rf.getNodes().filter((n) => n.parentId && groups.has(n.parentId)).map((n) => n.id));
        void commit('Ungroup', [...groups].map((id): Op => ({ op: 'ungroup', id })));
      },
      editSelected: () => {
        const { nodes, edges } = selection();
        const only = nodes[0] ?? edges[0];
        if (nodes.length + edges.length === 1 && !only.data?.locked) setEditingId(only.id);
      },
      moveSelectionToLayer: (layer: string) => {
        const { nodes, edges } = selection();
        // A grouped node moves with its group.
        const ids = new Set([...nodes.map((n) => n.parentId ?? n.id), ...edges.map((e) => e.id)]);
        const current = new Map([...rf.getNodes().map((n) => [n.id, n.data.node.layer] as const), ...rf.getEdges().map((e) => [e.id, e.data?.edge.layer] as const)]);
        const ops = [...ids].filter((id) => current.get(id) !== layer).map((id): Op => ({ op: 'setLayer', id, layer }));
        if (!ids.size) return notify('Select nodes or connections first, then choose the layer to move them to.');
        void commit('Move to layer', ops);
      },
      fit: () => void rf.fitView({ padding: 0.2, duration: 200 }),
      zoomToSelection: () => {
        const { nodes } = selection();
        if (nodes.length) void rf.fitView({ nodes, padding: 0.4, maxZoom: 2, duration: 200 });
      },
    };
  }, [activeLayer, commit, insert, notify, pendingSelection, rf, selection, selectionClip, setEditingId]);
}
