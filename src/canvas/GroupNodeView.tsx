import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { LabelEditor } from '../components/LabelEditor';
import { useEditor } from '../state/editor';
import type { MapNode } from './flow';
import { textColorFor } from './geometry';

/** Container drawn behind its members; its bounds are fitted by the engine, so no resize handles. */
export const GroupNodeView = memo(function GroupNodeView({ id, data }: NodeProps<MapNode>) {
  const { editingId, setEditingId, commit } = useEditor();
  const { node } = data;
  return (
    <div className="map-group" style={{ borderColor: node.style.stroke, color: node.style.fill ? textColorFor(node.style.fill) : undefined }}>
      <div className="map-group-fill" style={{ background: node.style.fill }} />
      {editingId === id ? (
        <LabelEditor
          className="map-group-editor"
          initial={node.label}
          ariaLabel="Group label"
          onCancel={() => setEditingId(null)}
          onCommit={(text) => {
            setEditingId(null);
            void commit('Rename group', [{ op: 'setNodeLabel', id, label: text }]);
          }}
        />
      ) : (
        <div className="map-group-title">{node.label}</div>
      )}
    </div>
  );
});
