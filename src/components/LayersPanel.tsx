import { useState } from 'react';
import { useEdges, useNodes } from '@xyflow/react';
import type { Layer, Op } from '../bridge/api';
import { newId } from '../canvas/actions';
import type { LinkEdge, MapNode } from '../canvas/flow';
import { useEditor } from '../state/editor';
import { LabelEditor } from './LabelEditor';

/** Layers, top of the stack first. The highlighted layer receives new content. */
export function LayersPanel({ layers, onMoveSelection }: { layers: Layer[]; onMoveSelection: (id: string) => void }) {
  const { commit, ask, notify, activeLayer, setActiveLayer } = useEditor();
  const nodes = useNodes<MapNode>();
  const edges = useEdges<LinkEdge>();
  const [renaming, setRenaming] = useState<string | null>(null);
  const count = (id: string) => nodes.filter((n) => n.data.node.layer === id).length + edges.filter((e) => e.data?.edge.layer === id).length;

  const update = (l: Layer, label: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked'>>) =>
    void commit(label, [{ op: 'updateLayer', id: l.id, name: l.name, visible: l.visible, locked: l.locked, ...patch }]);

  const add = async () => {
    const layer: Layer = { id: newId(), name: `Layer ${layers.length + 1}`, visible: true, locked: false };
    const index = activeLayer ? layers.findIndex((l) => l.id === activeLayer.id) + 1 : layers.length;
    if (await commit('Add layer', [{ op: 'addLayer', layer, index }])) setActiveLayer(layer.id);
  };

  const remove = async (l: Layer) => {
    if (layers.length === 1) return notify('A map needs at least one layer.');
    const i = layers.indexOf(l);
    const into = layers[i > 0 ? i - 1 : 1];
    const n = count(l.id);
    if (n > 0) {
      const choice = await ask({
        title: `Delete layer “${l.name}”?`,
        body: `Its ${n} item${n === 1 ? '' : 's'} will move to “${into.name}”. You can undo this.`,
        choices: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'delete', label: 'Delete Layer', primary: true },
        ],
        cancel: 'cancel',
      });
      if (choice !== 'delete') return;
    }
    const op: Op = { op: 'removeLayer', id: l.id, ...(n > 0 ? { into: into.id } : {}) };
    void commit('Delete layer', [op]);
  };

  const move = (l: Layer, by: 1 | -1) => {
    const index = layers.indexOf(l) + by;
    if (index >= 0 && index < layers.length) void commit('Reorder layers', [{ op: 'moveLayer', id: l.id, index }]);
  };

  return (
    <div className="layers">
      <div className="layers-head">
        <h2>Layers</h2>
        <button type="button" onClick={() => void add()}>
          Add Layer
        </button>
      </div>
      <ul>
        {[...layers].reverse().map((l, k) => (
          <li key={l.id} className={l.id === activeLayer?.id ? 'active' : undefined} data-layer={l.id}>
            <div className="layer-row">
              {renaming === l.id ? (
                <LabelEditor
                  className="layer-rename"
                  initial={l.name}
                  ariaLabel="Layer name"
                  onCancel={() => setRenaming(null)}
                  onCommit={(name) => {
                    setRenaming(null);
                    if (name.trim() && name !== l.name) update(l, 'Rename layer', { name: name.trim() });
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="layer-name"
                  aria-pressed={l.id === activeLayer?.id}
                  title="Click to make this the active layer for new content. Double-click to rename."
                  onClick={() => setActiveLayer(l.id)}
                  onDoubleClick={() => setRenaming(l.id)}
                >
                  {l.name}
                </button>
              )}
              <span className="layer-count" title="Items on this layer">
                {count(l.id)}
              </span>
            </div>
            <div className="layer-actions">
              <button type="button" aria-pressed={!l.visible} aria-label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} onClick={() => update(l, l.visible ? 'Hide layer' : 'Show layer', { visible: !l.visible })}>
                {l.visible ? 'Hide' : 'Show'}
              </button>
              <button type="button" aria-pressed={l.locked} aria-label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} onClick={() => update(l, l.locked ? 'Unlock layer' : 'Lock layer', { locked: !l.locked })}>
                {l.locked ? 'Unlock' : 'Lock'}
              </button>
              <button type="button" aria-label={`Raise ${l.name}`} disabled={k === 0} onClick={() => move(l, 1)}>
                ↑
              </button>
              <button type="button" aria-label={`Lower ${l.name}`} disabled={k === layers.length - 1} onClick={() => move(l, -1)}>
                ↓
              </button>
              <button type="button" aria-label={`Move selection to ${l.name}`} title="Move the selected items to this layer" onClick={() => onMoveSelection(l.id)}>
                Move Here
              </button>
              <button type="button" aria-label={`Delete ${l.name}`} onClick={() => void remove(l)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">Hidden layers are skipped by selection, search, Fit and SVG export. Locked layers stay visible but cannot be edited.</p>
    </div>
  );
}
