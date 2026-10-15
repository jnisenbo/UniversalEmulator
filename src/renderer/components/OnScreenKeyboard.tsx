import { useCallback, useState } from 'react';
import type { InputEvent } from '../input/actions';
import { api } from '../api';
import { play } from '../sound/sfx';
import { ButtonHints } from './ButtonHints';
import { Modal } from './controller/Modal';

type Key = { label: string; insert?: string; action?: 'shift' | 'symbols' | 'space' | 'delete' | 'paste' | 'done'; wide?: number };

const chars = (s: string): Key[] => [...s].map((c) => ({ label: c, insert: c }));
const BOTTOM: Key[] = [
  { label: 'Shift', action: 'shift', wide: 2 },
  { label: '#+=', action: 'symbols', wide: 2 },
  { label: 'Space', action: 'space', wide: 4 },
  { label: 'Delete', action: 'delete', wide: 2 },
  { label: 'Paste', action: 'paste', wide: 2 },
  { label: 'Done', action: 'done', wide: 2 },
];
const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm._@'];
const SYMBOLS = ['!@#$%^&*()', '{}[]<>/\\|~', ':;"\',?+=_`', '-.€£¥•§¶°…'];

/**
 * Typing with a controller: the D-pad moves over the keys, the bottom face
 * button types. B deletes (or closes when empty), L is Shift, R is Space,
 * Options is Done. A physical keyboard still works while it's open.
 */
export function OnScreenKeyboard({ title, initial, onDone, onClose }: { title: string; initial: string; onDone(value: string): void; onClose(): void }) {
  const [text, setText] = useState(initial);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [pos, setPos] = useState({ row: 1, col: 0 });

  const rows: Key[][] = [...(symbols ? SYMBOLS : LETTERS).map((r) => chars(shift && !symbols ? r.toUpperCase() : r)), BOTTOM];

  const press = useCallback(
    (key: Key) => {
      play('move');
      if (key.insert !== undefined) {
        setText((t) => t + key.insert);
        if (shift) setShift(false);
        return;
      }
      switch (key.action) {
        case 'shift':
          return setShift((s) => !s);
        case 'symbols':
          return setSymbols((s) => !s);
        case 'space':
          return setText((t) => t + ' ');
        case 'delete':
          return setText((t) => t.slice(0, -1));
        case 'paste':
          void api.invoke('clipboard:readText').then((clip) => setText((t) => t + clip.replace(/[\r\n]+/g, ' ').trim()));
          return;
        case 'done':
          play('confirm');
          onDone(text);
          onClose();
          return;
      }
    },
    [shift, text, onDone, onClose],
  );

  /** Moving between rows of different lengths keeps the same horizontal position. */
  const moveRow = (from: number, to: number, col: number): number => {
    const width = (r: Key[]): number => r.reduce((n, k) => n + (k.wide ?? 1), 0);
    const startOf = (r: Key[], i: number): number => r.slice(0, i).reduce((n, k) => n + (k.wide ?? 1), 0);
    const x = (startOf(rows[from]!, col) + (rows[from]![col]?.wide ?? 1) / 2) / width(rows[from]!);
    const target = rows[to]!;
    const tx = x * width(target);
    let acc = 0;
    for (let i = 0; i < target.length; i++) {
      acc += target[i]!.wide ?? 1;
      if (tx < acc) return i;
    }
    return target.length - 1;
  };

  const onInput = useCallback(
    (e: InputEvent) => {
      if (e.kind === 'release') return;
      switch (e.action) {
        case 'up':
        case 'down': {
          const to = Math.max(0, Math.min(rows.length - 1, pos.row + (e.action === 'down' ? 1 : -1)));
          if (to !== pos.row) {
            play('move');
            setPos({ row: to, col: moveRow(pos.row, to, pos.col) });
          }
          return;
        }
        case 'left':
        case 'right': {
          const len = rows[pos.row]!.length;
          setPos({ row: pos.row, col: (pos.col + (e.action === 'right' ? 1 : -1) + len) % len });
          play('move');
          return;
        }
        case 'confirm':
          return press(rows[pos.row]![pos.col]!);
        case 'back':
          if (e.kind !== 'press' && !text) return;
          if (text) {
            play('move');
            setText((t) => t.slice(0, -1));
          } else {
            play('back');
            onClose();
          }
          return;
        case 'tabPrev':
          if (e.kind === 'press') setShift((s) => !s);
          return;
        case 'tabNext':
          setText((t) => t + ' ');
          return;
        case 'menu':
          if (e.kind === 'press') press({ label: 'Done', action: 'done' });
          return;
      }
    },
    [rows, pos, press, text, onClose],
  );

  return (
    <Modal
      title={title}
      onInput={onInput}
      footer={
        <ButtonHints
          hints={[
            { button: 'south', label: 'Type' },
            { button: 'east', label: text ? 'Delete' : 'Cancel' },
            { button: 'L', label: 'Shift' },
            { button: 'R', label: 'Space' },
            { button: 'menu', label: 'Done' },
          ]}
        />
      }
    >
      <div className="osk">
        <div className="osk-field mono" aria-live="polite">
          {text}
          <span className="osk-caret" />
        </div>
        {rows.map((row, r) => (
          <div key={r} className="osk-row">
            {row.map((key, c) => (
              <button
                key={`${r}-${c}`}
                type="button"
                className="osk-key"
                data-focused={pos.row === r && pos.col === c}
                data-on={(key.action === 'shift' && shift) || (key.action === 'symbols' && symbols)}
                style={{ flexGrow: key.wide ?? 1 }}
                onClick={() => {
                  setPos({ row: r, col: c });
                  press(key);
                }}
              >
                {key.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
