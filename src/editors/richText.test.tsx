import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { RichNode } from '../bridge/api';
import { RichTextView } from './RichTextView';
import { docFromPlain, isSafeUrl, normalize, plainOf } from './richText';

const p = (...content: object[]) => ({ type: 'paragraph', content });

describe('rich text helpers', () => {
  it('keeps supported structure and drops everything else', () => {
    const tiptap = {
      type: 'doc',
      content: [
        p(
          { type: 'text', text: 'safe', marks: [{ type: 'link', attrs: { href: 'https://example.org', target: '_blank', rel: 'x', class: null } }] },
          { type: 'text', text: 'evil', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }, { type: 'bold' }] },
          { type: 'image', attrs: { src: 'http://tracker.example/x.png' } },
          { type: 'text', text: '' },
        ),
        { type: 'heading', content: [{ type: 'text', text: 'dropped' }] },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p({ type: 'text', text: 'one' })] }] },
        { type: 'bulletList', content: [] },
      ],
    };
    expect(normalize(tiptap)).toEqual({
      type: 'doc',
      content: [
        p({ type: 'text', text: 'safe', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] }, { type: 'text', text: 'evil', marks: [{ type: 'bold' }] }),
        { type: 'orderedList', content: [{ type: 'listItem', content: [p({ type: 'text', text: 'one' })] }] },
      ],
    });
  });

  it('detects plain text so unformatted labels stay plain', () => {
    expect(plainOf(normalize(docFromPlain('Line one\nLine two')))).toBe('Line one\nLine two');
    expect(plainOf({ type: 'doc', content: [p({ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' })] } as RichNode)).toBe('a\nb');
    expect(plainOf({ type: 'doc', content: [p({ type: 'text', text: 'a', marks: [{ type: 'bold' }] })] } as RichNode)).toBeNull();
    expect(plainOf(docFromPlain(''))).toBe('');
  });

  it('accepts only http, https and mailto links', () => {
    expect(['https://a.b', 'http://a.b', 'mailto:x@y.z'].every(isSafeUrl)).toBe(true);
    expect(['javascript:alert(1)', 'file:///c:/x', 'https://a b', 'data:text/html,x', 'https://'].some(isSafeUrl)).toBe(false);
  });

  it('renders formatting as elements and links as inert text', () => {
    const doc = normalize({
      type: 'doc',
      content: [
        p({ type: 'text', text: 'B', marks: [{ type: 'bold' }] }, { type: 'text', text: 'L', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] }),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p({ type: 'text', text: '<img src=x onerror=alert(1)>' })] }] },
      ],
    });
    const { container } = render(<RichTextView doc={doc} />);
    expect(container.querySelector('strong')?.textContent).toBe('B');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('.rich-link')?.getAttribute('title')).toBe('https://example.org');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('li')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
