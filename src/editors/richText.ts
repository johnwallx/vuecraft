// Conversions between Tiptap's JSON and the engine's rich-text subset
// (crates/map-core/src/rich.rs). The engine validates again; this keeps what we send minimal.
import type { RichMark, RichNode } from '../bridge/api';

const BLOCKS = new Set(['paragraph', 'bulletList', 'orderedList', 'listItem']);
const INLINE = new Set(['text', 'hardBreak']);

/** http(s) or mailto, as accepted by the engine. */
export function isSafeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    url.length <= 2048 &&
    !/[\s\p{Cc}]/u.test(url) &&
    (((lower.startsWith('https://') || lower.startsWith('http://')) && url.length > 8) ||
      (lower.startsWith('mailto:') && url.length > 7))
  );
}

interface LooseNode {
  type?: string;
  text?: string;
  content?: LooseNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

function marks(raw: LooseNode['marks']): RichMark[] {
  const out: RichMark[] = [];
  for (const m of raw ?? []) {
    if ((m.type === 'bold' || m.type === 'italic') && !out.some((o) => o.type === m.type)) out.push({ type: m.type });
    const href = m.attrs?.href;
    if (m.type === 'link' && typeof href === 'string' && isSafeUrl(href) && !out.some((o) => o.type === 'link')) {
      out.push({ type: 'link', attrs: { href } });
    }
  }
  return out;
}

function clean(n: LooseNode): RichNode | null {
  if (n.type === 'text') {
    if (!n.text) return null;
    const m = marks(n.marks);
    return m.length ? { type: 'text', text: n.text, marks: m } : { type: 'text', text: n.text };
  }
  if (n.type === 'hardBreak') return { type: 'hardBreak' };
  if (n.type !== 'doc' && !(n.type && BLOCKS.has(n.type))) return null;
  const content = (n.content ?? []).map(clean).filter((c): c is RichNode => c !== null);
  const out: RichNode = { type: n.type };
  if (content.length) out.content = content;
  const start = n.attrs?.start;
  if (n.type === 'orderedList' && typeof start === 'number' && start > 1) out.attrs = { start };
  if ((n.type === 'bulletList' || n.type === 'orderedList') && !content.length) return null;
  return out;
}

/** Keeps only supported elements, formatting and safe links. */
export function normalize(json: unknown): RichNode {
  return clean(json as LooseNode) ?? { type: 'doc' };
}

/** The plain label when the document has no formatting or lists, else null. */
export function plainOf(doc: RichNode): string | null {
  const lines: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type !== 'paragraph') return null;
    let line = '';
    for (const inline of block.content ?? []) {
      if (!INLINE.has(inline.type) || inline.marks?.length) return null;
      line += inline.type === 'hardBreak' ? '\n' : (inline.text ?? '');
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Editor content for a plain label: one paragraph per line. */
export function docFromPlain(label: string): RichNode {
  return {
    type: 'doc',
    content: label.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}
