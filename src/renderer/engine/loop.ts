/**
 * The single display-synced clock. Input is read, springs are stepped and
 * sounds are triggered in the same frame, in that order, so motion and
 * feedback never lag behind the press that caused them.
 */
type Phase = 'input' | 'animate';
type Tick = (dt: number, now: number) => void;

const subscribers: Record<Phase, Set<Tick>> = { input: new Set(), animate: new Set() };
let last = 0;
let running = false;

function frame(now: number): void {
  // Clamp dt: after a stall (window hidden, emulator in front) springs shouldn't jump.
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  for (const fn of subscribers.input) fn(dt, now);
  for (const fn of subscribers.animate) fn(dt, now);
  requestAnimationFrame(frame);
}

export function onFrame(phase: Phase, fn: Tick): () => void {
  subscribers[phase].add(fn);
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
  return () => subscribers[phase].delete(fn);
}
