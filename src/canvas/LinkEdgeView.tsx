import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { LabelEditor } from '../components/LabelEditor';
import { useEditor } from '../state/editor';
import type { MapNode, LinkEdge } from './flow';
import { edgeGeometry, type Box } from './geometry';

// Live position (follows drags), current size, document shape.
function box(n: InternalNode<MapNode>): Box {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    width: n.width ?? n.measured.width ?? 0,
    height: n.height ?? n.measured.height ?? 0,
    shape: n.data.node.style.shape,
  };
}

/** Edge attached to node outlines along the center line (or a curve), not to fixed handles. */
export const LinkEdgeView = memo(function LinkEdgeView({ id, source, target, data, selected, markerEnd, markerStart }: EdgeProps<LinkEdge>) {
  const src = useInternalNode<MapNode>(source);
  const tgt = useInternalNode<MapNode>(target);
  const { editingId, setEditingId, commit } = useEditor();
  if (!src || !tgt || !data) return null;

  const { edge } = data;
  const g = edgeGeometry(box(src), box(tgt), edge.style.curve);
  const editing = editingId === id;

  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={18}
        style={{ stroke: edge.style.color ?? 'var(--edge-color)', strokeWidth: selected ? 2.75 : 1.5 }}
      />
      {(edge.label || editing) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label nodrag nopan${selected ? ' is-selected' : ''}`}
            data-edge-id={id}
            style={{ transform: `translate(-50%, -50%) translate(${g.label.x}px, ${g.label.y}px)` }}
            onDoubleClick={() => !data.locked && setEditingId(id)}
          >
            {editing ? (
              <LabelEditor
                initial={edge.label}
                ariaLabel="Connection label"
                onCancel={() => setEditingId(null)}
                onCommit={(text) => {
                  setEditingId(null);
                  void commit('Edit connection label', [{ op: 'setEdgeLabel', id, label: text }]);
                }}
              />
            ) : (
              edge.label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
