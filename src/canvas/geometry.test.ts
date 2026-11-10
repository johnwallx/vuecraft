import { describe, expect, it } from 'vitest';
import { boundaryPoint, edgeGeometry, textColorFor, type Box } from './geometry';

// Same cases as crates/map-core/src/svg.rs, so canvas and export agree.
const box = (shape: Box['shape'], x = 0, y = 0): Box => ({ x, y, width: 100, height: 50, shape });

describe('geometry (parity with Rust export)', () => {
  it('finds boundary points on each shape', () => {
    expect(boundaryPoint(box('rectangle'), { x: 1000, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(boundaryPoint(box('rectangle'), { x: 150, y: 125 })).toEqual({ x: 75, y: 50 });
    const e = boundaryPoint(box('ellipse'), { x: 150, y: 125 });
    expect(((e.x - 50) / 50) ** 2 + ((e.y - 25) / 25) ** 2).toBeCloseTo(1, 9);
    const d = boundaryPoint(box('diamond'), { x: 150, y: 125 });
    expect(Math.abs(d.x - 50) / 50 + Math.abs(d.y - 25) / 25).toBeCloseTo(1, 9);
    expect(boundaryPoint(box('rounded'), { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it('bends curved edges left of travel and puts the label on the curve', () => {
    const g = edgeGeometry(box('rectangle'), box('rectangle', 400), 'curved');
    expect(g.control!.y).toBeLessThan(25);
    expect(g.label.y).toBeCloseTo(0.25 * g.start.y + 0.5 * g.control!.y + 0.25 * g.end.y, 9);
    expect(g.path.startsWith('M ')).toBe(true);
  });

  it('straight edges run between outlines', () => {
    const g = edgeGeometry(box('rectangle'), box('rectangle', 400), 'straight');
    expect(g.start).toEqual({ x: 100, y: 25 });
    expect(g.end).toEqual({ x: 400, y: 25 });
    expect(g.label).toEqual({ x: 250, y: 25 });
  });

  it('picks readable text colors', () => {
    expect(textColorFor('#ffffff')).toBe('#1f2328');
    expect(textColorFor('#000')).toBe('#ffffff');
    expect(textColorFor('#1e3a8a')).toBe('#ffffff');
    expect(textColorFor('#fde68a')).toBe('#1f2328');
  });
});
