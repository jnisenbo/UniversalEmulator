import { useCallback, useState, type ReactNode } from 'react';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { ButtonHints } from './ButtonHints';
import { Modal } from './controller/Modal';

export interface MenuItem {
  label: string;
  detail?: string;
  disabled?: boolean;
  run(): void;
}

/** A short vertical list of actions in a modal. Closes itself after running one unless `keepOpen`. */
export function ActionMenu({ title, items, onClose, children, keepOpen }: { title: string; items: MenuItem[]; onClose(): void; children?: ReactNode; keepOpen?: boolean }) {
  const [focus, setFocus] = useState(0);
  const runAt = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item || item.disabled) return play('edge');
      play('confirm');
      if (!keepOpen) onClose();
      item.run();
    },
    [items, onClose, keepOpen],
  );
  const onInput = useCallback(
    (e: InputEvent) => {
      if (e.action === 'back' && e.kind === 'press') {
        play('back');
        onClose();
      } else if ((e.action === 'up' || e.action === 'down') && e.kind !== 'release') {
        setFocus((f) => Math.max(0, Math.min(items.length - 1, f + (e.action === 'down' ? 1 : -1))));
        play('move');
      } else if (e.action === 'confirm' && e.kind === 'release') {
        runAt(focus);
      }
    },
    [items.length, focus, onClose, runAt],
  );
  return (
    <Modal title={title} onInput={onInput} footer={<ButtonHints hints={[{ button: 'south', label: 'Select' }, { button: 'east', label: 'Close' }]} />}>
      <div className="menu-narrow">
        {children}
        {items.map((item, i) => (
          <div key={i} className="srow" data-focused={i === focus} data-disabled={!!item.disabled} onClick={() => runAt(i)}>
            <div className="srow-text">
              <div className="srow-label">{item.label}</div>
              {item.detail && <div className="srow-detail">{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
