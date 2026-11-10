// Edge geometry for on-screen rendering. Must match crates/map-core/src/svg.rs,
// which is the canonical definition used for export.
import type { Curve, Shape } from '../bridge/api';

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: Shape;
}

const CURVE_BEND = 0.2;

export const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Point where a ray from the box center toward `toward` leaves the shape. */
export function boundaryPoint(b: Box, toward: Pt): Pt {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = b.width / 2;
  const hh = b.height / 2;
  let t: number;
  switch (b.shape) {
    case 'ellipse':
      t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      break;
    default:
      t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export interface EdgeGeometry {
  start: Pt;
  end: Pt;
  control: Pt | null;
  label: Pt;
  path: string;
}

export function edgeGeometry(src: Box, tgt: Box, curve: Curve): EdgeGeometry {
  const a = center(src);
  const b = center(tgt);
  if (curve === 'curved') {
    const control = {
      x: (a.x + b.x) / 2 + (b.y - a.y) * CURVE_BEND,
      y: (a.y + b.y) / 2 - (b.x - a.x) * CURVE_BEND,
    };
    const start = boundaryPoint(src, control);
    const end = boundaryPoint(tgt, control);
    return {
      start,
      end,
      control,
      label: {
        x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
        y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
      },
      path: `M ${start.x},${start.y} Q ${control.x},${control.y} ${end.x},${end.y}`,
    };
  }
  const start = boundaryPoint(src, b);
  const end = boundaryPoint(tgt, a);
  return {
    start,
    end,
    control: null,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    path: `M ${start.x},${start.y} L ${end.x},${end.y}`,
  };
}

/** Black or white text, whichever reads better on `fill` (same rule as export). */
export function textColorFor(fill: string): string {
  let hex = fill.replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return (Number.isNaN(v) ? 255 : v) / 255;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  return lum > 0.5 ? '#1f2328' : '#ffffff';
}
