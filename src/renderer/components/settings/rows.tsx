import { useEffect, useRef, useState } from 'react';

export type Row =
  | { kind: 'action'; id: string; label: string; value?: string; detail?: string; danger?: boolean; progress?: number; onConfirm(): void }
  | { kind: 'toggle'; id: string; label: string; detail?: string; value: boolean; onChange(v: boolean): void }
  | { kind: 'slider'; id: string; label: string; detail?: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void }
  | { kind: 'choice'; id: string; label: string; detail?: string; options: { label: string; swatch?: string }[]; index: number; onChange(i: number): void }
  /** `value` is what's shown; `editValue` (default: value) is what editing starts from. Unchanged edits aren't committed. */
  | { kind: 'text'; id: string; label: string; detail?: string; value: string; editValue?: string; onCommit(v: string): void }
  | { kind: 'info'; id: string; label: string; detail?: string; level?: 'ok' | 'warn' | 'error' };

export const isFocusable = (r: Row): boolean => r.kind !== 'info';

/** Left/right on a row: adjusts sliders and choices. Returns true if handled. */
export function adjustRow(row: Row, dir: -1 | 1): boolean {
  if (row.kind === 'slider') {
    const v = Math.min(row.max, Math.max(row.min, Math.round((row.value + dir * row.step) / row.step) * row.step));
    if (v !== row.value) row.onChange(Number(v.toFixed(4)));
    return true;
  }
  if (row.kind === 'choice') {
    const i = (row.index + dir + row.options.length) % row.options.length;
    row.onChange(i);
    return true;
  }
  if (row.kind === 'toggle') {
    if ((dir === 1) !== row.value) row.onChange(dir === 1);
    return true;
  }
  return false;
}

export function RowView({ row, focused, editing, onEditDone, onPointerConfirm }: { row: Row; focused: boolean; editing: boolean; onEditDone(): void; onPointerConfirm(): void }) {
  return (
    <div className={`srow srow-${row.kind}`} data-focused={focused} data-level={row.kind === 'info' ? (row.level ?? 'ok') : undefined} onClick={onPointerConfirm}>
      <div className="srow-text">
        <div className="srow-label">{row.label}</div>
        {row.detail && <div className="srow-detail">{row.detail}</div>}
      </div>
      <div className="srow-control">
        {row.kind === 'action' && row.progress !== undefined && (
          <span className="progress">
            <span style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </span>
        )}
        {row.kind === 'action' && <span className="srow-value">{row.value}</span>}
        {row.kind === 'toggle' && <span className="switch" data-on={row.value} />}
        {row.kind === 'slider' && (
          <span className="slider">
            <span className="slider-track">
              <span className="slider-fill" style={{ width: `${((row.value - row.min) / (row.max - row.min)) * 100}%` }} />
            </span>
            <span className="slider-value">{row.format(row.value)}</span>
          </span>
        )}
        {row.kind === 'choice' && (
          <span className="choices">
            {row.options.map((o, i) => (
              <span key={o.label} className="choice" data-selected={i === row.index} title={o.label} style={o.swatch ? { background: o.swatch } : undefined}>
                {o.swatch ? '' : o.label}
              </span>
            ))}
          </span>
        )}
        {row.kind === 'text' && <TextValue row={row} editing={editing} onDone={onEditDone} />}
      </div>
    </div>
  );
}

function TextValue({ row, editing, onDone }: { row: Extract<Row, { kind: 'text' }>; editing: boolean; onDone(): void }) {
  const initial = row.editValue ?? row.value;
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(initial);
    if (editing) requestAnimationFrame(() => input.current?.select());
  }, [editing, initial]);
  if (!editing) return <span className="srow-value mono">{row.value}</span>;
  return (
    <input
      ref={input}
      className="text-input mono"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          // Keep Enter/Escape from also reaching the global controller/keyboard input.
          e.stopPropagation();
          e.preventDefault();
          if (e.key === 'Enter' && draft.trim() !== initial.trim()) row.onCommit(draft.trim());
          onDone();
        }
      }}
      onBlur={onDone}
    />
  );
}
