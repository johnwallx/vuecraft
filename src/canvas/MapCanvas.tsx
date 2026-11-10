import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react';
import type { Snapshot } from '../bridge/api';
import { cannotCreateOn, useEditor } from '../state/editor';
import { ConceptNodeView } from './ConceptNodeView';
import { GroupNodeView } from './GroupNodeView';
import { LinkEdgeView } from './LinkEdgeView';
import { toFlowEdges, toFlowNodes, type MapNode, type LinkEdge } from './flow';
import { newEdge } from './actions';

const nodeTypes = { concept: ConceptNodeView, mapgroup: GroupNodeView };
const edgeTypes = { link: LinkEdgeView };

interface Props {
  snapshot: Snapshot | null;
  generation: number;
  dark: boolean;
  onCreateAt: (p: XYPosition) => void;
}

export function MapCanvas({ snapshot, generation, dark, onCreateAt }: Props) {
  const { commit, setEditingId, pendingSelection, activeLayer, notify } = useEditor();
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkEdge>([]);
  const { fitView, setViewport, screenToFlowPosition, getNode } = useReactFlow<MapNode, LinkEdge>();
  const initialized = useNodesInitialized();
  const fitPending = useRef(false);
  const edgeColor = dark ? '#aab3bf' : '#4b5563';

  // Reconcile React Flow's interactive state with each canonical snapshot.
  useEffect(() => {
    if (!snapshot) return;
    const doc = snapshot.document;
    let select = pendingSelection.current;
    if (select) {
      const ids = new Set([...doc.nodes, ...doc.edges].map((o) => o.id));
      if ([...select].every((id) => ids.has(id))) pendingSelection.current = null;
      else select = null;
    }
    setNodes((prev) => toFlowNodes(doc, prev, select));
    setEdges((prev) => toFlowEdges(doc, prev, edgeColor, select));
  }, [snapshot, edgeColor, pendingSelection, setNodes, setEdges]);

  // Frame a newly opened or created document once its nodes are measured.
  useEffect(() => {
    fitPending.current = true;
  }, [generation]);
  useEffect(() => {
    if (!fitPending.current || !snapshot) return;
    const docNodes = snapshot.document.nodes;
    if (docNodes.length === 0) {
      fitPending.current = false;
      void setViewport({ x: 0, y: 0, zoom: 1 });
    } else if (initialized && nodes.length === docNodes.length && nodes.every((n, i) => n.id === docNodes[i].id)) {
      fitPending.current = false;
      void fitView({ padding: 0.2, maxZoom: 1.5 });
    }
  }, [nodes, initialized, snapshot, fitView, setViewport]);

  const onNodeDragStop: OnNodeDrag<MapNode> = useCallback(
    (_event, _node, dragged) => {
      void commit(
        dragged.length > 1 ? 'Move nodes' : 'Move node',
        dragged.map((n) => {
          // Members are positioned relative to their (top-level) group; the document is absolute.
          const parent = n.parentId ? getNode(n.parentId) : undefined;
          const [ox, oy] = parent ? [parent.position.x, parent.position.y] : [0, 0];
          return { op: 'moveNode', id: n.id, x: n.position.x + ox, y: n.position.y + oy };
        }),
      );
    },
    [commit, getNode],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      const blocked = cannotCreateOn(activeLayer);
      if (blocked) return notify(blocked);
      void commit('Connect', [{ op: 'addEdge', edge: newEdge(c.source, c.target, activeLayer!.id) }]);
    },
    [activeLayer, commit, notify],
  );

  const onDoubleClick = (e: MouseEvent) => {
    if ((e.target as Element).classList.contains('react-flow__pane')) {
      onCreateAt(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    }
  };

  // React Flow nudges focused, selected nodes with the arrow keys without a drag-stop event, so the
  // move would show on screen but never reach the document. Keep arrows for text editing only.
  // shortcut: no keyboard moves; commit them as moveNode transactions when keyboard access is added.
  const blockArrowMoves = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow') && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) e.stopPropagation();
  };

  return (
    <div className="canvas" onDoubleClick={onDoubleClick} onKeyDownCapture={blockArrowMoves}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && ![c.source, c.target].some((id) => getNode(id)?.type === 'mapgroup')}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.Straight}
        onNodeDoubleClick={(_, n) => !n.data.locked && setEditingId(n.id)}
        onEdgeDoubleClick={(_, e) => !e.data?.locked && setEditingId(e.id)}
        deleteKeyCode={null}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        zoomOnDoubleClick={false}
        // Stacking follows the document (groups below concepts); selection must not cover neighbours.
        elevateNodesOnSelect={false}
        minZoom={0.1}
        maxZoom={4}
        colorMode={dark ? 'dark' : 'light'}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
