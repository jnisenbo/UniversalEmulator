import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControllerProfile } from '@shared/settings';
import { onFrame } from '../../engine/loop';
import { getPadSnapshot, setStickNavigation } from '../../input/input';
import type { InputEvent } from '../../input/actions';
import { play } from '../../sound/sfx';
import { useStore } from '../../state/store';
import { ButtonHints } from '../ButtonHints';
import { adjustRow, RowView, type Row } from '../settings/rows';
import { Modal } from './Modal';

const BUCKETS = 48;

const BUTTONS: [number, string][] = [
  [0, 'South'], [1, 'East'], [2, 'West'], [3, 'North'],
  [4, 'L'], [5, 'R'], [6, 'L trigger'], [7, 'R trigger'],
  [8, 'Create'], [9, 'Options'], [10, 'L stick'], [11, 'R stick'],
  [12, 'Up'], [13, 'Down'], [14, 'Left'], [15, 'Right'], [16, 'Home'], [17, 'Touchpad'],
];

/** Per-angle maximum deflection: rotating the stick around its rim traces the gate. */
class GateTrace {
  max = new Float32Array(BUCKETS);
  add(x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m < 0.2) return;
    const b = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    this.max[b] = Math.max(this.max[b]!, Math.min(1.2, m));
  }
  coverage(): number {
    return this.max.filter((v) => v > 0.5).length / BUCKETS;
  }
  /** Mean rim distance, as a fraction of a perfect circle. */
  roundness(): number {
    const seen = [...this.max].filter((v) => v > 0.5);
    return seen.length ? seen.reduce((a, b) => a + Math.min(b, 1), 0) / seen.length : 0;
  }
  path(r: number): string {
    return [...this.max]
      .map((m, i) => {
        const a = (i / BUCKETS) * 2 * Math.PI - Math.PI;
        return `${i ? 'L' : 'M'}${(Math.cos(a) * m * r).toFixed(1)},${(Math.sin(a) * m * r).toFixed(1)}`;
      })
      .join(' ') + 'Z';
  }
}

function StickView({ side, deadzone, range, dotRef, pathRef, readoutRef }: {
  side: string;
  deadzone: number;
  range: number;
  dotRef: React.RefObject<SVGCircleElement | null>;
  pathRef: React.RefObject<SVGPathElement | null>;
  readoutRef: React.RefObject<HTMLDivElement | null>;
}) {
  const R = 70;
  return (
    <div className="stick">
      <svg viewBox="-90 -90 180 180" className="stick-svg">
        <circle r={R} className="stick-rim" />
        <circle r={R * range} className="stick-range" />
        <circle r={Math.max(1, R * deadzone)} className="stick-dead" />
        <path ref={pathRef} className="stick-trace" d="" />
        <circle ref={dotRef} r={7} className="stick-dot" />
      </svg>
      <div className="stick-label">{side} stick</div>
      <div className="stick-readout" ref={readoutRef}>Rotate slowly around the edge</div>
    </div>
  );
}

/**
 * Calibration and test. Sticks only draw here (they don't navigate): the D-pad
 * moves between settings. Everything updates per frame via refs, not React state.
 */
export function Calibration({ onClose }: { onClose(): void }) {
  const profile = useStore((s) => s.settings!.controller);
  const updateSettings = useStore((s) => s.updateSettings);
  const [focus, setFocus] = useState(0);

  const traces = useRef([new GateTrace(), new GateTrace()]);
  const dots = [useRef<SVGCircleElement>(null), useRef<SVGCircleElement>(null)];
  const paths = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const readouts = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const triggerFills = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const buttonEls = useRef<(HTMLSpanElement | null)[]>([]);
  const padName = useRef<HTMLDivElement>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    setStickNavigation(false);
    return () => setStickNavigation(true);
  }, []);

  useEffect(() => {
    let frame = 0;
    return onFrame('animate', () => {
      const snap = getPadSnapshot();
      if (padName.current) padName.current.textContent = snap ? snap.id : 'No controller detected. Press any button.';
      if (!snap) return;
      const p = profileRef.current;
      const sticks: [number, number, number, number][] = [
        [snap.axes[0] ?? 0, snap.axes[1] ?? 0, p.deadzoneLeft, p.rangeLeft],
        [snap.axes[2] ?? 0, snap.axes[3] ?? 0, p.deadzoneRight, p.rangeRight],
      ];
      sticks.forEach(([x, y, dz, range], i) => {
        traces.current[i]!.add(x, y);
        dots[i]!.current?.setAttribute('cx', String(x * 70));
        dots[i]!.current?.setAttribute('cy', String(y * 70));
        const m = Math.hypot(x, y);
        dots[i]!.current?.classList.toggle('in-dead', m < dz);
        dots[i]!.current?.classList.toggle('at-max', m >= range);
      });
      // Path + text are cheaper to refresh every few frames.
      if (frame++ % 6 === 0) {
        traces.current.forEach((t, i) => {
          paths[i]!.current?.setAttribute('d', t.path(70));
          const el = readouts[i]!.current;
          if (el) {
            const cov = t.coverage();
            el.textContent = cov < 0.9 ? `Rotate slowly around the edge · ${Math.round(cov * 100)}%` : `Reach ${Math.round(t.roundness() * 100)}% of full travel all the way around`;
          }
        });
      }
      [6, 7].forEach((b, i) => {
        const v = snap.buttons[b] ?? 0;
        const el = triggerFills[i]!.current;
        if (el) {
          el.style.transform = `scaleX(${v})`;
          el.dataset.pressed = String(v >= p.triggerThreshold);
        }
      });
      BUTTONS.forEach(([b], i) => {
        const el = buttonEls.current[i];
        if (el) el.dataset.on = String((snap.buttons[b] ?? 0) > 0.5);
      });
    });
  }, []);

  const set = useCallback((patch: Partial<ControllerProfile>) => void updateSettings({ controller: patch }), [updateSettings]);
  const pctFmt = (v: number): string => `${Math.round(v * 100)}%`;

  const rows: Row[] = useMemo(
    () => [
      { kind: 'slider', id: 'dzl', label: 'Left stick dead zone', value: profile.deadzoneLeft, min: 0, max: 0.4, step: 0.01, format: pctFmt, onChange: (v) => set({ deadzoneLeft: v }) },
      { kind: 'slider', id: 'dzr', label: 'Right stick dead zone', value: profile.deadzoneRight, min: 0, max: 0.4, step: 0.01, format: pctFmt, onChange: (v) => set({ deadzoneRight: v }) },
      { kind: 'slider', id: 'rl', label: 'Left stick full-tilt point', value: profile.rangeLeft, min: 0.6, max: 1, step: 0.02, format: pctFmt, onChange: (v) => set({ rangeLeft: v }) },
      { kind: 'slider', id: 'rr', label: 'Right stick full-tilt point', value: profile.rangeRight, min: 0.6, max: 1, step: 0.02, format: pctFmt, onChange: (v) => set({ rangeRight: v }) },
      { kind: 'slider', id: 'tt', label: 'Trigger press point', value: profile.triggerThreshold, min: 0.1, max: 0.9, step: 0.05, format: pctFmt, onChange: (v) => set({ triggerThreshold: v }) },
      {
        kind: 'action',
        id: 'rumble',
        label: 'Test vibration',
        onConfirm: () => {
          const pad = getPadSnapshot()?.pad;
          void pad?.vibrationActuator?.playEffect('dual-rumble', { duration: 450, strongMagnitude: 0.9, weakMagnitude: 0.6 });
        },
      },
      {
        kind: 'action',
        id: 'reset',
        label: 'Reset stick trace',
        onConfirm: () => {
          traces.current = [new GateTrace(), new GateTrace()];
        },
      },
      { kind: 'action', id: 'done', label: 'Done', onConfirm: onClose },
    ],
    [profile, set, onClose],
  );

  const onInput = useCallback(
    (e: InputEvent) => {
      if (e.source === 'stick') return;
      const row = rows[focus];
      if (e.action === 'back' && e.kind === 'press') {
        play('back');
        onClose();
      } else if ((e.action === 'up' || e.action === 'down') && e.kind !== 'release') {
        setFocus((f) => Math.max(0, Math.min(rows.length - 1, f + (e.action === 'down' ? 1 : -1))));
        play('move');
      } else if ((e.action === 'left' || e.action === 'right') && e.kind !== 'release' && row) {
        if (adjustRow(row, e.action === 'right' ? 1 : -1)) play('move');
      } else if (e.action === 'confirm' && e.kind === 'release' && row?.kind === 'action') {
        play('confirm');
        row.onConfirm();
      }
    },
    [rows, focus, onClose],
  );

  return (
    <Modal title="Calibrate and test" onInput={onInput} footer={<ButtonHints hints={[{ button: 'south', label: 'Select' }, { button: 'east', label: 'Close' }]}><span className="hint-note">D-pad moves between settings · sticks only draw</span></ButtonHints>}>
      <div className="calib">
        <div className="calib-live">
          <div className="calib-pad" ref={padName} />
          <div className="sticks">
            {[0, 1].map((i) => (
              <StickView
                key={i}
                side={i === 0 ? 'Left' : 'Right'}
                deadzone={i === 0 ? profile.deadzoneLeft : profile.deadzoneRight}
                range={i === 0 ? profile.rangeLeft : profile.rangeRight}
                dotRef={dots[i]!}
                pathRef={paths[i]!}
                readoutRef={readouts[i]!}
              />
            ))}
          </div>
          <div className="triggers">
            {['L trigger', 'R trigger'].map((label, i) => (
              <div key={label} className="trigger">
                <span>{label}</span>
                <div className="trigger-bar">
                  <div className="trigger-fill" ref={triggerFills[i]} />
                  <div className="trigger-mark" style={{ left: `${profile.triggerThreshold * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="buttons-test">
            {BUTTONS.map(([b, label], i) => (
              <span key={b} className="btn-test" ref={(el) => { buttonEls.current[i] = el; }}>
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="calib-rows">
          {rows.map((r, i) => (
            <RowView key={r.id} row={r} focused={i === focus} editing={false} onEditDone={() => undefined} onPointerConfirm={() => { setFocus(i); if (r.kind === 'action') r.onConfirm(); }} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
