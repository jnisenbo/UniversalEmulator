import { useEffect, useRef, useState } from 'react';
import { EMULATOR_LABEL } from '@shared/platforms';
import type { SessionState } from '@shared/types';
import { onFrame } from '../engine/loop';
import { useStore } from '../state/store';
import { SPRINGS, Spring, prefersReducedMotion } from '../engine/spring';

export interface LaunchOrigin {
  rect: DOMRect;
  background: string;
}

/**
 * Launch transition: the tile grows from where it sits into the full screen,
 * then fades to black while the emulator starts. Returning plays the same path
 * in reverse into the same tile (enter and exit along one path).
 */
export function LaunchOverlay({ origin, session, onClosed }: { origin: LaunchOrigin | null; session: SessionState; onClosed(): void }) {
  const el = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const progress = useRef(new Spring(0, SPRINGS.surface));
  const [visible, setVisible] = useState(false);
  const closing = useRef(false);
  const startEpoch = useRef(0);
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  useEffect(() => {
    if (!origin) return;
    closing.current = false;
    startEpoch.current = useStore.getState().sessionEpoch;
    setVisible(true);
    progress.current.jump(0);
    progress.current.setTarget(1);
  }, [origin]);

  // Back to the library: reverse into the tile once this launch's session has
  // ended. (Not 'session is idle': it's idle for a moment right after Play, and
  // a game that exits instantly can go launching→ended→idle between renders.)
  useEffect(() => {
    if (origin && visible && sessionEpoch > startEpoch.current) {
      closing.current = true;
      progress.current.setTarget(0);
    }
  }, [sessionEpoch, origin, visible]);

  useEffect(() => {
    if (!visible || !origin) return;
    return onFrame('animate', (dt) => {
      const p = progress.current.step(dt);
      const node = el.current;
      if (!node) return;
      const { innerWidth: W, innerHeight: H } = window;
      const r = origin.rect;
      if (prefersReducedMotion()) {
        // Reduced motion: cross-fade only, no travel.
        node.style.transform = 'none';
        node.style.opacity = String(p);
      } else {
        const sx = r.width / W + (1 - r.width / W) * p;
        const sy = r.height / H + (1 - r.height / H) * p;
        node.style.transform = `translate3d(${r.left * (1 - p)}px, ${r.top * (1 - p)}px, 0) scale(${sx}, ${sy})`;
        node.style.borderRadius = `${(1 - p) * 18}px`;
        node.style.opacity = '1';
      }
      if (veil.current) veil.current.style.opacity = String(Math.max(0, (p - 0.55) / 0.45));
      if (closing.current && p <= 0.001) {
        setVisible(false);
        onClosed();
      }
    });
  }, [visible, origin, onClosed]);

  if (!visible || !origin) return null;
  const emulator = 'emulator' in session ? EMULATOR_LABEL[session.emulator] : '';
  return (
    <div className="launch-overlay">
      <div className="launch-surface" ref={el} style={{ background: origin.background }} />
      <div className="launch-veil" ref={veil}>
        {session.kind === 'launching' && <div className="launch-status">Starting {emulator}…</div>}
        {session.kind === 'running' && (
          <div className="launch-status">
            <div>Now playing</div>
            <div className="launch-sub">
              Press the Home button (or hold Create + Options) for the Arcadia menu
            </div>
          </div>
        )}
        {session.kind === 'stopping' && <div className="launch-status">Closing {emulator}…</div>}
      </div>
    </div>
  );
}
