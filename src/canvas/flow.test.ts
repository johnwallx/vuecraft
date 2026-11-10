import { describe, expect, it } from 'vitest';
import type { DocNode, MapDocument } from '../bridge/api';
import { cloneWithNewIds } from './actions';
import { toFlowEdges, toFlowNodes, type MapNode } from './flow';

const node = (id: string, x = 0): DocNode => ({ id, label: id, x, y: 0, width: 100, height: 40, layer: 'base', style: { shape: 'rounded' } });
const doc = (nodes: DocNode[]): MapDocument => ({
  format: 'vuecraft',
  schemaVersion: 1,
  title: '',
  nodes,
  edges: [{ id: 'ab', source: 'a', target: 'b', label: '', layer: 'base', style: { arrow: 'both', curve: 'straight' } }],
  layers: [
    { id: 'base', name: 'Base', visible: true, locked: false },
    { id: 'top', name: 'Top', visible: true, locked: false },
  ],
});

describe('document to React Flow mapping', () => {
  it('uses canonical geometry and keeps selection', () => {
    const prev = toFlowNodes(doc([node('a'), node('b')]), []);
    prev[0].selected = true;
    const next = toFlowNodes(doc([node('a', 50), node('b')]), prev);
    expect(next[0]).toMatchObject({ id: 'a', position: { x: 50, y: 0 }, width: 100, height: 40, selected: true });
    expect(next[1].selected).toBe(false);
  });

  it('keeps transient geometry for a node being dragged', () => {
    const prev: MapNode[] = toFlowNodes(doc([node('a'), node('b')]), []);
    prev[1] = { ...prev[1], position: { x: 999, y: 5 }, dragging: true };
    const next = toFlowNodes(doc([node('a'), node('b')]), prev);
    expect(next[1].position).toEqual({ x: 999, y: 5 });
    expect(next[0].position).toEqual({ x: 0, y: 0 });
  });

  it('replaces selection when asked and drops deleted nodes', () => {
    const prev = toFlowNodes(doc([node('a'), node('b')]), []).map((n) => ({ ...n, selected: true }));
    const next = toFlowNodes(doc([node('b'), node('c')]), prev, new Set(['c']));
    expect(next.map((n) => [n.id, n.selected])).toEqual([
      ['b', false],
      ['c', true],
    ]);
  });

  it('puts groups first and members relative to their group', () => {
    const g: DocNode = { ...node('g', -20), y: -36, kind: 'group', width: 300, height: 100 };
    const a: DocNode = { ...node('a', 30), y: 10, parent: 'g' };
    const [first, second, third] = toFlowNodes(doc([a, node('b', 500), g]), []);
    expect(first).toMatchObject({ id: 'g', type: 'mapgroup', position: { x: -20, y: -36 } });
    expect(second).toMatchObject({ id: 'a', type: 'concept', parentId: 'g', position: { x: 50, y: 46 }, expandParent: true });
    expect(third).toMatchObject({ id: 'b', parentId: undefined, position: { x: 500, y: 0 } });
  });

  it('copies keep group membership only when the group is copied too', () => {
    const g: DocNode = { ...node('g'), kind: 'group' };
    const a: DocNode = { ...node('a'), parent: 'g' };
    const withGroup = cloneWithNewIds({ nodes: [a, g], edges: [] }, 0);
    expect(withGroup.nodes[0].kind).toBe('group');
    expect(withGroup.nodes[1].parent).toBe(withGroup.nodes[0].id);
    const memberOnly = cloneWithNewIds({ nodes: [a], edges: [] }, 0);
    expect('parent' in memberOnly.nodes[0]).toBe(false);
  });

  it('applies layer visibility, locking and stacking', () => {
    const d = doc([node('a'), { ...node('b'), layer: 'top' }]);
    let [a, b] = toFlowNodes(d, []);
    expect([a.zIndex, b.zIndex]).toEqual([0, 10]);
    expect([a.hidden, a.draggable, a.data.locked]).toEqual([false, true, false]);
    d.layers[1] = { ...d.layers[1], visible: false };
    d.layers[0] = { ...d.layers[0], locked: true };
    const prev = toFlowNodes(d, []).map((n) => ({ ...n, selected: true }));
    [a, b] = toFlowNodes(d, prev);
    expect([a.draggable, a.data.locked, a.selected]).toEqual([false, true, true]);
    expect([b.hidden, b.selected]).toEqual([true, false]);
    // The edge's own layer is visible, but one end is hidden, so it hides too.
    const [edge] = toFlowEdges(d, [], '#000');
    expect([edge.hidden, edge.data?.locked]).toEqual([true, true]);
  });

  it('maps arrow styles to markers', () => {
    const [e] = toFlowEdges(doc([node('a'), node('b')]), [], '#123456');
    expect(e.markerEnd).toMatchObject({ color: '#123456' });
    expect(e.markerStart).toBeDefined();
  });

  it('copies get new ids and keep only internal connections', () => {
    const clip = {
      nodes: [node('a'), node('b')],
      edges: [
        { id: 'ab', source: 'a', target: 'b', label: 'x', layer: 'base', style: { arrow: 'end' as const, curve: 'straight' as const } },
        { id: 'ac', source: 'a', target: 'outside', label: '', layer: 'base', style: { arrow: 'end' as const, curve: 'straight' as const } },
      ],
    };
    const out = cloneWithNewIds(clip, 24);
    const ids = out.nodes.map((n) => n.id);
    expect(ids).not.toContain('a');
    expect(new Set(ids).size).toBe(2);
    expect(out.nodes[0].x).toBe(24);
    expect(out.edges).toHaveLength(1);
    expect([out.edges[0].source, out.edges[0].target]).toEqual(ids);
    expect(out.edges[0].label).toBe('x');
  });
});
