import { useEffect, useRef } from 'react';

interface Props {
  initial: string;
  /** Called once with the final text and the textarea (for measuring overflow). */
  onCommit: (text: string, el: HTMLTextAreaElement) => void;
  onCancel: () => void;
  className?: string;
  ariaLabel: string;
}

/** Plain multiline label editor: Enter commits, Shift+Enter adds a line, Escape cancels. */
export function LabelEditor({ initial, onCommit, onCancel, className, ariaLabel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current || !ref.current) return;
    done.current = true;
    if (commit) onCommit(ref.current.value, ref.current);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      // nodrag/nopan/nowheel: React Flow must not drag, pan or zoom while typing.
      className={`label-editor nodrag nopan nowheel ${className ?? ''}`}
      defaultValue={initial}
      spellCheck
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
