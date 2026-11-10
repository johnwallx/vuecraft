// Mapping from the canonical Rust document to React Flow's interactive state.
import { MarkerType, type Edge, type EdgeMarker, type Node } from '@xyflow/react';
import { isGroup, type DocEdge, type DocNode, type MapDocument } from '../bridge/api';

export type MapNode = Node<{ node: DocNode; locked?: boolean }, 'concept' | 'mapgroup'>;
export type LinkEdge = Edge<{ edge: DocEdge; locked?: boolean }, 'link'>;

const layerState = (doc: MapDocument) => new Map(doc.layers.map((l, index) => [l.id, { ...l, index }]));

/**
 * Canonical positions and sizes win, except for nodes the user is dragging or
 * resizing right now, which keep their transient geometry. `select` replaces
 * the current selection when given.
 */
export function toFlowNodes(doc: MapDocument, prev: MapNode[], select?: Set<string> | null): MapNode[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const layers = layerState(doc);
  // React Flow needs parents before their children; groups also stack beneath concepts.
  const ordered = [...doc.nodes.filter(isGroup), ...doc.nodes.filter((n) => !isGroup(n))];
  return ordered.map((n) => {
    const p = old.get(n.id);
    const live = p && (p.dragging || p.resizing);
    const parent = n.parent ? byId.get(n.parent) : undefined;
    // The document stores absolute positions; React Flow wants children relative to the parent.
    const position = parent ? { x: n.x - parent.x, y: n.y - parent.y } : { x: n.x, y: n.y };
    const layer = layers.get(n.layer);
    const hidden = !layer?.visible;
    const locked = !!layer?.locked;
    return {
      id: n.id,
      type: isGroup(n) ? 'mapgroup' : 'concept',
      parentId: parent?.id,
      expandParent: parent ? true : undefined,
      position: live ? p.position : position,
      width: live ? p.width : n.width,
      height: live ? p.height : n.height,
      data: { node: n, locked },
      // Hidden content cannot be selected or hit; locked content cannot be moved.
      hidden,
      draggable: !locked,
      // Higher layers stack above lower ones.
      zIndex: (layer?.index ?? 0) * 10,
      selected: !hidden && (select ? select.has(n.id) : (p?.selected ?? false)),
      dragging: p?.dragging,
      resizing: p?.resizing,
      measured: p?.measured,
    };
  });
}

export function toFlowEdges(
  doc: MapDocument,
  prev: LinkEdge[],
  defaultColor: string,
  select?: Set<string> | null,
): LinkEdge[] {
  const old = new Map(prev.map((e) => [e.id, e]));
  const layers = layerState(doc);
  const nodeVisible = new Map(doc.nodes.map((n) => [n.id, !!layers.get(n.layer)?.visible]));
  return doc.edges.map((e) => {
    const layer = layers.get(e.layer);
    // Shown only when its own layer and both ends are visible.
    const hidden = !layer?.visible || !nodeVisible.get(e.source) || !nodeVisible.get(e.target);
    const marker: EdgeMarker = { type: MarkerType.ArrowClosed, color: e.style.color ?? defaultColor, width: 18, height: 18 };
    return {
      id: e.id,
      type: 'link',
      source: e.source,
      target: e.target,
      data: { edge: e, locked: !!layer?.locked },
      hidden,
      selected: !hidden && (select ? select.has(e.id) : (old.get(e.id)?.selected ?? false)),
      markerEnd: e.style.arrow === 'none' ? undefined : marker,
      markerStart: e.style.arrow === 'both' ? marker : undefined,
    };
  });
}
