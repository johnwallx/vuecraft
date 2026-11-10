import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { Op, Shape } from '../bridge/api';
import { RichTextEditor } from '../editors/RichTextEditor';
import { RichTextView } from '../editors/RichTextView';
import { docFromPlain, plainOf } from '../editors/richText';
import { useEditor } from '../state/editor';
import type { MapNode } from './flow';
import { textColorFor } from './geometry';
import { useImageData } from './useImageData';

const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

const STROKE = 1.5;

function Outline({ shape, w, h }: { shape: Shape; w: number; h: number }) {
  const i = STROKE / 2;
  switch (shape) {
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(w / 2 - i, 0)} ry={Math.max(h / 2 - i, 0)} />;
    case 'diamond':
      return <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} />;
    case 'rectangle':
      return <rect x={i} y={i} width={Math.max(w - STROKE, 0)} height={Math.max(h - STROKE, 0)} />;
    default:
      return <rect x={i} y={i} width={Math.max(w - STROKE, 0)} height={Math.max(h - STROKE, 0)} rx={Math.min(10, h / 2)} />;
  }
}

export const ConceptNodeView = memo(function ConceptNodeView({ id, data, selected, width = 0, height = 0 }: NodeProps<MapNode>) {
  const { editingId, setEditingId, commit } = useEditor();
  const { node } = data;
  const editing = editingId === id;
  const textColor = node.style.fill ? textColorFor(node.style.fill) : 'var(--node-text)';
  const image = useImageData(node.image);

  return (
    <div className={`concept shape-${node.style.shape}${node.image ? ' has-image' : ''}${data.locked ? ' is-locked' : ''}`} style={{ color: textColor }} title={data.locked ? 'On a locked layer' : undefined}>
      <NodeResizer
        isVisible={!!selected && !editing && !data.locked}
        minWidth={40}
        minHeight={24}
        color="var(--accent)"
        onResizeEnd={(_, p) =>
          commit('Resize', [{ op: 'resizeNode', id, x: p.x, y: p.y, width: p.width, height: p.height }])
        }
      />
      <svg className="concept-shape" width={width} height={height} aria-hidden="true">
        <g fill={node.style.fill ?? 'var(--node-fill)'} stroke={node.style.stroke ?? 'var(--node-stroke)'} strokeWidth={STROKE}>
          <Outline shape={node.style.shape} w={width} h={height} />
        </g>
      </svg>
      {node.image &&
        (image === null ? (
          <div className="concept-image missing">Image unavailable</div>
        ) : (
          <img className="concept-image" src={image} alt="" draggable={false} />
        ))}
      {editing ? (
        <RichTextEditor
          initial={node.text ?? docFromPlain(node.label)}
          onCancel={() => setEditingId(null)}
          onCommit={(doc, el) => {
            setEditingId(null);
            // Unformatted text stays a plain label; formatting is stored as structured rich text.
            const plain = plainOf(doc);
            const ops: Op[] = [plain !== null ? { op: 'setNodeLabel', id, label: plain } : { op: 'setNodeText', id, text: doc }];
            // Grow the node so the committed text stays visible.
            const overflow = el.scrollHeight - el.clientHeight;
            if (overflow > 0) {
              ops.push({ op: 'resizeNode', id, x: node.x, y: node.y, width: node.width, height: Math.ceil(node.height + overflow) });
            }
            void commit('Edit label', ops);
          }}
        />
      ) : (
        <div className={`concept-label${node.text ? ' rich' : ''}`}>{node.text ? <RichTextView doc={node.text} /> : node.label}</div>
      )}
      {SIDES.map(([key, pos]) => (
        <Handle key={key} id={key} type="source" position={pos} />
      ))}
    </div>
  );
});
