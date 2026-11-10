import { useState } from 'react';
import type { Layer } from '../bridge/api';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';

const TABS = ['Inspect', 'Layers'] as const;
type Tab = (typeof TABS)[number];

export function Sidebar({ layers, onMoveSelectionToLayer }: { layers: Layer[]; onMoveSelectionToLayer: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('Inspect');
  return (
    <aside className="sidebar">
      <div className="tabs" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Inspect' ? <Inspector /> : <LayersPanel layers={layers} onMoveSelection={onMoveSelectionToLayer} />}
      </div>
    </aside>
  );
}
