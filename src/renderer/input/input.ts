import { onFrame } from '../engine/loop';
import type { Action, InputEvent, InputHandler, InputSource } from './actions';
import { isDirection } from './actions';

/**
 * Standard Gamepad mapping (Chromium reads the DualSense through Apple's
 * GameController framework on macOS):
 *   0 south · 1 east · 2 west · 3 north · 4 L1 · 5 R1 · 6 L2 · 7 R2
 *   8 Create · 9 Options · 10 L3 · 11 R3 · 12–15 D-pad · 16 Home
 */
const BUTTON_ACTIONS: Partial<Record<number, Action>> = {
  0: 'confirm',
  1: 'back',
  4: 'tabPrev',
  5: 'tabNext',
  9: 'menu',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};

const KEY_ACTIONS: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  q: 'tabPrev',
  e: 'tabNext',
  m: 'menu',
};

// Repeat timing: a deliberate first delay, then accelerate the longer you hold.
const FIRST_REPEAT_MS = 320;
const REPEAT_START_MS = 120;
const REPEAT_MIN_MS = 55;
// Stick: press beyond 0.5, release under 0.3 (hysteresis avoids chatter).
const STICK_PRESS = 0.5;
const STICK_RELEASE = 0.3;

interface HeldState {
  since: number;
  lastFire: number;
  repeats: number;
  source: InputSource;
}

const handlers: InputHandler[] = [];
const held = new Map<Action, HeldState>();
let enabled = true;
let stickNavigation = true;
/** After input resumes (e.g. returning from a game) ignore the pad until it's neutral. */
let latched = false;
let activePadIndex: number | null = null;
const lastActivity = { at: 0, source: 'key' as InputSource };
const activityListeners = new Set<(source: InputSource) => void>();

export function pushInputHandler(h: InputHandler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.lastIndexOf(h);
    if (i !== -1) handlers.splice(i, 1);
  };
}

function dispatch(e: InputEvent): void {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const r = handlers[i]!(e);
    if (r) return; // consumed; otherwise fall through to the handler below
  }
}

export function setInputEnabled(on: boolean): void {
  if (on && !enabled) latched = true;
  enabled = on;
  if (!on) {
    for (const [action, h] of held) dispatch({ action, kind: 'release', source: h.source });
    held.clear();
  }
}

/** Calibration turns this off so moving the sticks doesn't navigate. */
export function setStickNavigation(on: boolean): void {
  stickNavigation = on;
}

export function onInputActivity(fn: (source: InputSource) => void): () => void {
  activityListeners.add(fn);
  return () => activityListeners.delete(fn);
}

function noteActivity(source: InputSource): void {
  const changed = lastActivity.source !== source;
  lastActivity.at = performance.now();
  lastActivity.source = source;
  if (changed) for (const fn of activityListeners) fn(source);
}

function repeatInterval(h: HeldState, now: number, stickMagnitude: number): number {
  if (h.source === 'stick') {
    // Deflection sets the speed: gentle push = browse, full push = scrub.
    const t = Math.min(1, Math.max(0, (stickMagnitude - STICK_PRESS) / (1 - STICK_PRESS)));
    return h.repeats === 0 ? 260 - 120 * t : 200 - 145 * t;
  }
  if (h.repeats === 0) return FIRST_REPEAT_MS;
  const heldFor = now - h.since;
  return Math.max(REPEAT_MIN_MS, REPEAT_START_MS - (heldFor - FIRST_REPEAT_MS) / 20);
}

function update(action: Action, down: boolean, source: InputSource, now: number, magnitude = 1): void {
  const h = held.get(action);
  if (down && !h) {
    held.set(action, { since: now, lastFire: now, repeats: 0, source });
    noteActivity(source === 'stick' ? 'pad' : source);
    dispatch({ action, kind: 'press', source });
  } else if (down && h && isDirection(action)) {
    const interval = repeatInterval(h, now, magnitude);
    if (now - h.lastFire >= interval) {
      dispatch({ action, kind: 'repeat', source: h.source, interval: now - h.lastFire });
      h.lastFire = now;
      h.repeats++;
    }
  } else if (!down && h && h.source === source) {
    held.delete(action);
    dispatch({ action, kind: 'release', source, interval: now - h.lastFire });
  }
}

export interface PadSnapshot {
  id: string;
  axes: readonly number[];
  buttons: readonly number[];
  pad: Gamepad;
}

let snapshot: PadSnapshot | null = null;
/** Raw state of the active controller this frame (for calibration / test screens). */
export const getPadSnapshot = (): PadSnapshot | null => snapshot;

function readPads(now: number): void {
  const pads = navigator.getGamepads?.() ?? [];
  // The active pad is whichever one was touched most recently.
  for (const p of pads) {
    if (!p) continue;
    if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > STICK_PRESS)) activePadIndex = p.index;
  }
  const pad = activePadIndex !== null ? pads[activePadIndex] : pads.find((p) => p);
  if (!pad) {
    snapshot = null;
    return;
  }
  snapshot = { id: pad.id, axes: pad.axes, buttons: pad.buttons.map((b) => b.value), pad };
  if (!enabled) return;

  const anyDown = pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > STICK_RELEASE);
  if (latched) {
    if (anyDown) return;
    latched = false;
  }

  for (const [index, action] of Object.entries(BUTTON_ACTIONS)) {
    update(action!, pad.buttons[Number(index)]?.pressed ?? false, 'pad', now);
  }

  if (!stickNavigation) return;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  const stickDir = (axis: number, neg: Action, pos: Action): void => {
    for (const [action, sign] of [[neg, -1], [pos, 1]] as const) {
      const v = axis * sign;
      const isHeld = held.get(action)?.source === 'stick';
      update(action, isHeld ? v > STICK_RELEASE : v > STICK_PRESS, 'stick', now, Math.abs(axis));
    }
  };
  // Only the dominant axis navigates, so diagonals don't zig-zag.
  if (Math.abs(x) >= Math.abs(y)) {
    stickDir(x, 'left', 'right');
    stickDir(0, 'up', 'down');
  } else {
    stickDir(y, 'up', 'down');
    stickDir(0, 'left', 'right');
  }
}

function onKey(e: KeyboardEvent, down: boolean): void {
  const target = e.target as HTMLElement | null;
  // Text fields keep their keys, except Escape/Enter to leave them.
  if (target?.matches('input, textarea') && e.key !== 'Escape' && e.key !== 'Enter') return;
  const action = KEY_ACTIONS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action || !enabled) return;
  e.preventDefault();
  const now = performance.now();
  if (down && e.repeat) {
    // Use our own repeat cadence, not the OS key-repeat rate.
    return;
  }
  update(action, down, 'key', now);
}

let installed = false;
export function installInput(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => setInputEnabled(false));
  window.addEventListener('focus', () => setInputEnabled(true));
  window.addEventListener('pointermove', () => noteActivity('pointer'), { passive: true });
  onFrame('input', (_dt, now) => {
    readPads(now);
    // Keyboard keys held: drive repeats from the same clock.
    for (const [action, h] of held) if (h.source === 'key') update(action, true, 'key', now);
  });
}

export const isPadDualSense = (id: string): boolean => /dualsense|054c.*0ce6|054c.*0df2|ps5/i.test(id);
