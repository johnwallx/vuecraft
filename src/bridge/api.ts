// Typed bridge to the Rust document engine (src-tauri/src/main.rs).
// These types mirror crates/map-core/src/model.rs and session.rs.
import { invoke } from '@tauri-apps/api/core';

export type Shape = 'rectangle' | 'rounded' | 'ellipse' | 'diamond';
export type Arrow = 'none' | 'end' | 'both';
export type Curve = 'straight' | 'curved';

export interface NodeStyle {
  shape: Shape;
  fill?: string;
  stroke?: string;
}

export interface EdgeStyle {
  color?: string;
  arrow: Arrow;
  curve: Curve;
}

export type NodeKind = 'concept' | 'group';

/** Validated rich-text subset (see crates/map-core/src/rich.rs). */
export interface RichMark {
  type: 'bold' | 'italic' | 'link';
  attrs?: { href: string };
}

export interface RichNode {
  type: string;
  text?: string;
  content?: RichNode[];
  marks?: RichMark[];
  attrs?: { start?: number };
}

/** A link or local file reference (see crates/map-core/src/assets.rs). */
export interface Resource {
  kind: 'url' | 'file';
  /** http/https/mailto URL, or an absolute path. */
  target: string;
  title?: string;
}

export interface DocNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Omitted for concepts. */
  kind?: NodeKind;
  /** Containing group. Positions are absolute regardless. */
  parent?: string;
  layer: string;
  /** Formatted text; `label` is then its plain-text projection. */
  text?: RichNode;
  resources?: Resource[];
  /** Embedded image id; fetch its data with `api.imageData`. */
  image?: string;
  style: NodeStyle;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export const isGroup = (n: DocNode) => n.kind === 'group';

export interface DocEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  layer: string;
  style: EdgeStyle;
}

export interface MapDocument {
  format: 'vuecraft';
  schemaVersion: number;
  title: string;
  nodes: DocNode[];
  edges: DocEdge[];
  /** Bottom to top. */
  layers: Layer[];
}

export type Op =
  | { op: 'addNode'; node: DocNode; index?: number }
  | { op: 'removeNode'; id: string }
  | { op: 'addEdge'; edge: DocEdge; index?: number }
  | { op: 'removeEdge'; id: string }
  | { op: 'moveNode'; id: string; x: number; y: number }
  | { op: 'resizeNode'; id: string; x: number; y: number; width: number; height: number }
  | { op: 'setNodeLabel'; id: string; label: string }
  | { op: 'setNodeText'; id: string; text: RichNode }
  | { op: 'setNodeResources'; id: string; resources: Resource[] }
  | { op: 'setNodeImage'; id: string; image: string | null }
  | { op: 'setNodeStyle'; id: string; style: NodeStyle }
  | { op: 'setEdgeLabel'; id: string; label: string }
  | { op: 'setEdgeStyle'; id: string; style: EdgeStyle }
  | { op: 'group'; group: DocNode; children: string[]; index?: number }
  | { op: 'ungroup'; id: string }
  | { op: 'addLayer'; layer: Layer; index?: number }
  | { op: 'removeLayer'; id: string; into?: string }
  | { op: 'updateLayer'; id: string; name: string; visible: boolean; locked: boolean }
  | { op: 'moveLayer'; id: string; index: number }
  | { op: 'setLayer'; id: string; layer: string };

export interface Snapshot {
  document: MapDocument;
  /** Images this session holds (embedded image data is not sent with snapshots). */
  images: string[];
  revision: number;
  path: string | null;
  dirty: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export const FILE_EXTENSION = 'vuecraft';
/** Development-era files (working name Mapwright); they open and are saved as VUECraft documents. */
export const LEGACY_FILE_EXTENSION = 'mapw';

// In-flight backend calls, readable by the desktop test harness as window.__vuecraftDiag()
// to tell a stuck IPC call apart from an unresponsive page.
const inFlight = new Map<number, { cmd: string; at: number }>();
let calls = 0;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = ++calls;
  inFlight.set(id, { cmd, at: performance.now() });
  try {
    return await invoke<T>(cmd, args);
  } finally {
    inFlight.delete(id);
  }
}
(window as unknown as { __vuecraftDiag: () => object }).__vuecraftDiag = () => ({
  calls,
  pending: [...inFlight.values()].map((p) => ({ cmd: p.cmd, ms: Math.round(performance.now() - p.at) })),
});

export const api = {
  get: () => call<Snapshot>('doc_get'),
  newDocument: () => call<Snapshot>('doc_new'),
  apply: (baseRevision: number, label: string, ops: Op[]) =>
    call<Snapshot>('doc_apply', { tx: { baseRevision, label, ops } }),
  undo: () => call<Snapshot>('doc_undo'),
  redo: () => call<Snapshot>('doc_redo'),
  open: (path: string) => call<Snapshot>('doc_open', { path }),
  save: (path: string | null) => call<Snapshot>('doc_save', { path }),
  exportSvg: (path: string) => call<void>('export_svg', { path }),
  /** Stores an image file's bytes in the session and returns its id. */
  importImage: (path: string) => call<string>('image_import', { path }),
  imageData: (id: string) => call<string>('image_data', { id }),
  /** Per attachment: whether a local file exists; null when not checked. */
  resourceStatus: (node: string) => call<(boolean | null)[]>('resource_status', { node }),
  openResource: (node: string, index: number) => call<void>('resource_open', { node, index }),
  /** The file the app was started with (a double-clicked .vuecraft), returned only on the first call. */
  launchPath: () => call<string | null>('launch_path'),
  /** True only when the desktop test harness started the app (VUECRAFT_TEST_SEAM). */
  testSeamEnabled: () => call<boolean>('test_seam_enabled'),
};
