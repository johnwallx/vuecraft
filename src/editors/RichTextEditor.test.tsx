import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RichNode } from '../bridge/api';
import { RichTextEditor } from './RichTextEditor';

const link = { type: 'link', attrs: { href: 'https://example.org/paper' } } as const;
// The document desktop step 1 produces: "Claim **strong**" / "see [source](…)".
const formatted: RichNode = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Claim ' },
        { type: 'text', text: 'strong', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'source', marks: [link] },
      ],
    },
  ],
};

const texts = (n: RichNode): RichNode[] => (n.type === 'text' ? [n] : (n.content ?? []).flatMap(texts));

describe('RichTextEditor', () => {
  it('keeps links and bold when the content becomes a list', async () => {
    const onCommit = vi.fn();
    render(<RichTextEditor initial={formatted} onCommit={onCommit} onCancel={() => {}} />);
    const editor = await screen.findByLabelText('Node label');
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' })));
    await waitFor(() => expect(editor.querySelector('ul li')).not.toBeNull());
    await act(async () => fireEvent.blur(editor, { relatedTarget: document.body }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const doc = onCommit.mock.calls[0][0] as RichNode;
    expect(doc.content![0].type).toBe('bulletList');
    expect(texts(doc).find((t) => t.text === 'source')?.marks).toEqual([link]);
    expect(texts(doc).find((t) => t.text === 'strong')?.marks).toEqual([{ type: 'bold' }]);
  });
});
