import { useEdges, useNodes } from '@xyflow/react';
import type { Arrow, Curve, EdgeStyle, NodeStyle, Shape } from '../bridge/api';
import type { MapNode, LinkEdge } from '../canvas/flow';
import { useEditor } from '../state/editor';
import { Attachments } from './Attachments';

const PALETTE = ['#ffffff', '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e5e7eb', '#1e3a8a', '#065f46', '#7f1d1d', '#111827'];
const SHAPES: Shape[] = ['rounded', 'rectangle', 'ellipse', 'diamond'];
const ARROWS: Arrow[] = ['none', 'end', 'both'];
const CURVES: Curve[] = ['straight', 'curved'];

/** The value shared by every item, or undefined when they differ. */
function common<T>(items: T[]): T | undefined {
  return items.every((v) => v === items[0]) ? items[0] : undefined;
}

function Swatches({ label, value, onPick }: { label: string; value: string | undefined | null; onPick: (c: string | undefined) => void }) {
  return (
    <fieldset className="swatches">
      <legend>{label}</legend>
      <button type="button" className="swatch default" aria-label={`${label}: default`} aria-pressed={value === null} onClick={() => onPick(undefined)}>
        A
      </button>
      {PALETTE.map((c) => (
        <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`${label}: ${c}`} aria-pressed={value === c} onClick={() => onPick(c)} />
      ))}
    </fieldset>
  );
}

function Choices<T extends string>({ label, options, value, onPick }: { label: string; options: T[]; value: T | undefined; onPick: (v: T) => void }) {
  return (
    <fieldset className="choices">
      <legend>{label}</legend>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </fieldset>
  );
}

export function Inspector() {
  const { commit } = useEditor();
  const nodes = useNodes<MapNode>().filter((n) => n.selected);
  const edges = useEdges<LinkEdge>().filter((e) => e.selected && e.data);

  if (!nodes.length && !edges.length) {
    return (
      <div className="inspector" aria-label="Inspector">
        <h2>Getting started</h2>
        <ul className="hints">
          <li>Double-click the canvas to add a concept.</li>
          <li>Drag from a dot on a node’s edge to another node to connect them.</li>
          <li>Double-click a node or connection to edit its label. Enter saves, Shift+Enter adds a line, Esc cancels.</li>
          <li>Drag on empty canvas to select an area. Shift- or Ctrl-click adds to the selection.</li>
          <li>Scroll to zoom. Drag with the right or middle mouse button, or hold Space, to pan.</li>
          <li>Ctrl+C / Ctrl+V copy and paste, Ctrl+D duplicates.</li>
        </ul>
      </div>
    );
  }

  const locked = nodes.some((n) => n.data.locked) || edges.some((e) => e.data?.locked);
  const nodeStyles = nodes.map((n) => n.data.node.style);
  const edgeStyles = edges.map((e) => e.data!.edge.style);
  const styleNodes = (patch: Partial<NodeStyle>) =>
    void commit('Change node style', nodes.map((n) => ({ op: 'setNodeStyle', id: n.id, style: { ...n.data.node.style, ...patch } })));
  const styleEdges = (patch: Partial<EdgeStyle>) =>
    void commit('Change connection style', edges.map((e) => ({ op: 'setEdgeStyle', id: e.id, style: { ...e.data!.edge.style, ...patch } })));

  return (
    <div className="inspector" aria-label="Inspector">
      {locked && <p className="notice">The selection includes items on a locked layer. Unlock the layer to edit them.</p>}
      <fieldset className="plain" disabled={locked}>
      {nodes.length > 0 && (
        <section>
          <h2>{nodes.length === 1 ? (nodes[0].type === 'mapgroup' ? 'Group' : 'Node') : `${nodes.length} nodes`}</h2>
          {nodes.some((n) => n.type === 'concept') && (
            <Choices label="Shape" options={SHAPES} value={common(nodeStyles.map((s) => s.shape))} onPick={(shape) => styleNodes({ shape })} />
          )}
          <Swatches label="Fill" value={common(nodeStyles.map((s) => s.fill ?? null))} onPick={(fill) => styleNodes({ fill })} />
          <Swatches label="Border" value={common(nodeStyles.map((s) => s.stroke ?? null))} onPick={(stroke) => styleNodes({ stroke })} />
        </section>
      )}
      {edges.length > 0 && (
        <section>
          <h2>{edges.length === 1 ? 'Connection' : `${edges.length} connections`}</h2>
          <Swatches label="Color" value={common(edgeStyles.map((s) => s.color ?? null))} onPick={(color) => styleEdges({ color })} />
          <Choices label="Arrow" options={ARROWS} value={common(edgeStyles.map((s) => s.arrow))} onPick={(arrow) => styleEdges({ arrow })} />
          <Choices label="Line" options={CURVES} value={common(edgeStyles.map((s) => s.curve))} onPick={(curve) => styleEdges({ curve })} />
        </section>
      )}
      </fieldset>
      {nodes.length === 1 && nodes[0].type === 'concept' && <Attachments node={nodes[0].data.node} locked={locked} />}
    </div>
  );
}
