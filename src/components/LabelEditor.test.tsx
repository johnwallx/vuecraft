import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LabelEditor } from './LabelEditor';

function setup(initial = 'Old') {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<LabelEditor initial={initial} ariaLabel="Label" onCommit={onCommit} onCancel={onCancel} />);
  return { onCommit, onCancel, box: screen.getByLabelText<HTMLTextAreaElement>('Label') };
}

describe('LabelEditor', () => {
  it('starts focused with the text selected so typing replaces it', async () => {
    const { box, onCommit } = setup();
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('Evidence{Enter}');
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0]).toBe('Evidence');
  });

  it('Shift+Enter inserts a line break', async () => {
    const { onCommit } = setup('');
    await userEvent.keyboard('Line 1{Shift>}{Enter}{/Shift}Line 2{Enter}');
    expect(onCommit.mock.calls[0][0]).toBe('Line 1\nLine 2');
  });

  it('Escape cancels without committing, even when blur follows', async () => {
    const { box, onCommit, onCancel } = setup();
    await userEvent.keyboard('changed{Escape}');
    fireEvent.blur(box);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur commits exactly once', async () => {
    const { box, onCommit } = setup();
    await userEvent.keyboard('X');
    fireEvent.blur(box);
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('keeps key presses away from canvas shortcuts', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    const { box } = setup();
    fireEvent.keyDown(box, { key: 'Delete' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });
});
