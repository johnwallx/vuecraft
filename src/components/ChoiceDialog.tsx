import { useEffect, useRef } from 'react';

export interface DialogChoice {
  id: string;
  label: string;
  primary?: boolean;
  /** Pushed to the left edge, e.g. a destructive "Don't Save". */
  left?: boolean;
}

export interface DialogRequest {
  title: string;
  body: string;
  choices: DialogChoice[];
  /** Choice reported for Escape. */
  cancel: string;
}

/** In-app modal question (unsaved changes, destructive confirmations). */
export function ChoiceDialog({ request, onChoose }: { request: DialogRequest; onChoose: (id: string) => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  const left = request.choices.filter((c) => c.left);
  const right = request.choices.filter((c) => !c.left);
  const button = (c: DialogChoice) => (
    <button key={c.id} type="button" className={c.primary ? 'primary' : undefined} ref={c.primary ? primary : undefined} onClick={() => onChoose(c.id)}>
      {c.label}
    </button>
  );
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onChoose(request.cancel);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
        <h2 id="dialog-title">{request.title}</h2>
        <p id="dialog-body">{request.body}</p>
        <div className="modal-actions">
          {left.map(button)}
          <span className="spacer" />
          {right.map(button)}
        </div>
      </div>
    </div>
  );
}
