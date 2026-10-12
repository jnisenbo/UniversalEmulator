import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assignButton,
  CONSOLE_BUTTONS,
  compactLayout,
  LAYOUT_PRESETS,
  PAD_BUTTONS,
  PAD_INDEX,
  PAD_LABEL,
  resolveButton,
  type ButtonLayout as Layout,
  type PadButton,
} from '@shared/controls';
import { PLATFORM_INFO, PLATFORMS } from '@shared/platforms';
import { onFrame } from '../../engine/loop';
import { getPadSnapshot } from '../../input/input';
import type { InputEvent } from '../../input/actions';
import { play } from '../../sound/sfx';
import { useStore } from '../../state/store';
import { ButtonHints } from '../ButtonHints';
import { RowView, type Row } from '../settings/rows';
import { Modal } from './Modal';

const CAPTURE_TIMEOUT_MS = 6000;

const sameLayout = (a: Layout, b: Layout): boolean => JSON.stringify(compactLayout(a)) === JSON.stringify(compactLayout(b));

/** "GC A · Wii A · Switch B · …" for a slot. */
function meaning(slot: PadButton): string {
  return PLATFORMS.map((p) => {
    const b = CONSOLE_BUTTONS[p][slot];
    return b ? `${PLATFORM_INFO[p].short} ${b}` : null;
  })
    .filter(Boolean)
    .join(' · ');
}

/**
 * One button layout for every emulator. Pick a position, press the button you
 * want there; whatever was on that button moves to the old one (a swap), so
 * nothing is ever left unmapped.
 */
export function ButtonLayout({ onClose }: { onClose(): void }) {
  const layout = useStore((s) => s.settings!.controller.layout);
  const updateSettings = useStore((s) => s.updateSettings);
  const [focus, setFocus] = useState(0);
  const [capturing, setCapturing] = useState<PadButton | null>(null);
  const cooldown = useRef({ until: 0, swallowRelease: false });
  const listRef = useRef<HTMLDivElement>(null);

  const save = useCallback((next: Layout) => void updateSettings({ controller: { layout: compactLayout(next) } }), [updateSettings]);

  const presetIndex = LAYOUT_PRESETS.findIndex((p) => sameLayout(p.layout, layout));
  const rows: Row[] = useMemo(
    () => [
      {
        kind: 'choice',
        id: 'preset',
        label: 'Preset',
        detail: presetIndex >= 0 ? LAYOUT_PRESETS[presetIndex]!.detail : 'Custom layout',
        options: [...LAYOUT_PRESETS.map((p) => ({ label: p.label })), ...(presetIndex < 0 ? [{ label: 'Custom' }] : [])],
        index: presetIndex >= 0 ? presetIndex : LAYOUT_PRESETS.length,
        onChange: (i) => {
          const preset = LAYOUT_PRESETS[i];
          if (preset) save(preset.layout);
        },
      },
      ...PAD_BUTTONS.map<Row>((slot) => {
        const physical = resolveButton(layout, slot);
        return {
          kind: 'action',
          id: slot,
          label: PAD_LABEL[slot],
          detail: meaning(slot),
          value: physical === slot ? PAD_LABEL[physical] : `→ ${PAD_LABEL[physical]}`,
          onConfirm: () => setCapturing(slot),
        };
      }),
      { kind: 'action', id: 'reset', label: 'Reset to default', onConfirm: () => save({}) },
      { kind: 'action', id: 'done', label: 'Done', onConfirm: onClose },
    ],
    [layout, presetIndex, save, onClose],
  );

  // Keep the focused row visible in the scrolling list.
  useEffect(() => {
    listRef.current?.querySelectorAll('.srow')[focus]?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  // Capture: wait for every button to be released, then take the first new press.
  useEffect(() => {
    if (!capturing) return;
    const started = performance.now();
    let armed = false;
    return onFrame('input', (_dt, now) => {
      if (now - started > CAPTURE_TIMEOUT_MS) {
        setCapturing(null);
        play('back');
        return;
      }
      const snap = getPadSnapshot();
      if (!snap) return;
      const pressed = PAD_BUTTONS.filter((b) => (snap.buttons[PAD_INDEX[b]] ?? 0) > 0.6);
      if (!armed) {
        armed = pressed.length === 0;
        return;
      }
      const hit = pressed[0];
      if (!hit) return;
      save(assignButton(layout, capturing, hit));
      play('confirm');
      setCapturing(null);
      // The button just pressed must not also act on this screen.
      cooldown.current = { until: now + 300, swallowRelease: true };
    });
  }, [capturing, layout, save]);

  const onInput = useCallback(
    (e: InputEvent) => {
      if (capturing) {
        // Keyboard Escape cancels; controller presses are being captured.
        if (e.action === 'back' && e.source === 'key' && e.kind === 'press') {
          setCapturing(null);
          play('back');
        }
        return;
      }
      if (performance.now() < cooldown.current.until) return;
      if (cooldown.current.swallowRelease) {
        if (e.kind === 'press') cooldown.current.swallowRelease = false;
        else return;
      }
      const row = rows[focus];
      if (e.action === 'back' && e.kind === 'press') {
        play('back');
        onClose();
      } else if ((e.action === 'up' || e.action === 'down') && e.kind !== 'release') {
        setFocus((f) => Math.max(0, Math.min(rows.length - 1, f + (e.action === 'down' ? 1 : -1))));
        play('move');
      } else if ((e.action === 'left' || e.action === 'right') && e.kind === 'press' && row?.kind === 'choice') {
        const i = (row.index + (e.action === 'right' ? 1 : -1) + LAYOUT_PRESETS.length) % LAYOUT_PRESETS.length;
        row.onChange(i);
        play('move');
      } else if (e.action === 'confirm' && e.kind === 'release' && row?.kind === 'action') {
        play('confirm');
        row.onConfirm();
      }
    },
    [capturing, rows, focus, onClose],
  );

  return (
    <Modal
      title="Button layout"
      onInput={onInput}
      footer={
        <ButtonHints hints={[{ button: 'south', label: 'Change' }, { button: 'east', label: 'Close' }]}>
          <span className="hint-note">Applies to Dolphin, Ryubing, xemu and Arcadia · Xenia keeps its own layout</span>
        </ButtonHints>
      }
    >
      <div className="layout-list" ref={listRef}>
        {rows.map((r, i) => (
          <RowView
            key={r.id}
            row={r}
            focused={i === focus}
            editing={false}
            onEditDone={() => undefined}
            onPointerConfirm={() => {
              setFocus(i);
              if (r.kind === 'action') r.onConfirm();
            }}
          />
        ))}
      </div>
      {capturing && (
        <div className="capture">
          <div className="capture-card">
            <div className="capture-title">Press the button to use for</div>
            <div className="capture-slot">{PAD_LABEL[capturing]}</div>
            <div className="capture-detail">{meaning(capturing)}</div>
            <div className="capture-hint">Waits 6 seconds · Esc cancels</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
