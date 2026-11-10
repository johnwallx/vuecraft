import type { ReactNode } from 'react';
import type { RichNode } from '../bridge/api';

/**
 * Renders validated rich text as React elements (never injected HTML). Links are
 * shown, not followed: the canvas never navigates or fetches on its own.
 */
export function RichTextView({ doc }: { doc: RichNode }) {
  return <>{(doc.content ?? []).map(render)}</>;
}

function render(n: RichNode, key: number): ReactNode {
  const children = (n.content ?? []).map(render);
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{children.length ? children : ' '}</p>;
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={typeof n.attrs?.start === 'number' ? n.attrs.start : undefined}>
          {children}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'hardBreak':
      return <br key={key} />;
    case 'text': {
      let out: ReactNode = n.text;
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') out = <strong>{out}</strong>;
        else if (m.type === 'italic') out = <em>{out}</em>;
        else if (m.type === 'link') {
          out = (
            <span className="rich-link" data-href={m.attrs?.href} title={m.attrs?.href}>
              {out}
            </span>
          );
        }
      }
      return <span key={key}>{out}</span>;
    }
    default:
      return null;
  }
}
