import type { ReactNode } from 'react';
import { useInputHandler } from '../../input/useInput';
import type { InputEvent } from '../../input/actions';

/**
 * Modal task: dims and pushes back the screen behind it, and takes all input
 * while open (the handler always consumes).
 */
export function Modal({ title, children, onInput, footer }: { title: string; children: ReactNode; onInput(e: InputEvent): void; footer?: ReactNode }) {
  useInputHandler((e) => {
    onInput(e);
    return true;
  });
  return (
    <div className="modal-root">
      <div className="modal-scrim" />
      <div className="modal material-heavy" role="dialog" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
