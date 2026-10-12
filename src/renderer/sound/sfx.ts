/**
 * Original interface sounds, synthesized with Web Audio. Nothing sampled.
 * Fired from the same frame as the visual change they belong to.
 */
export type Sfx = 'move' | 'confirm' | 'back' | 'launch' | 'error' | 'tab' | 'edge';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.5;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = volume * 0.6;
  return { ctx, out: master! };
}

export function configureSfx(opts: { enabled: boolean; volume: number }): void {
  enabled = opts.enabled;
  volume = opts.volume;
}

function tone(freq: number, endFreq: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

let lastMove = 0;
export function play(s: Sfx): void {
  switch (s) {
    case 'move': {
      // Scrubbing fast shouldn't machine-gun: thin out ticks under 45ms apart.
      const now = performance.now();
      if (now - lastMove < 45) return;
      lastMove = now;
      tone(2200, 1500, 0.03, 0.12);
      break;
    }
    case 'tab':
      tone(1400, 1100, 0.05, 0.12, 'triangle');
      break;
    case 'confirm':
      tone(880, 880, 0.07, 0.16, 'triangle');
      tone(1320, 1320, 0.09, 0.12, 'triangle', 0.05);
      break;
    case 'back':
      tone(900, 520, 0.08, 0.13, 'triangle');
      break;
    case 'edge':
      tone(240, 200, 0.06, 0.12, 'sine');
      break;
    case 'launch':
      tone(330, 660, 0.5, 0.12, 'sine');
      tone(495, 990, 0.6, 0.08, 'sine', 0.08);
      break;
    case 'error':
      tone(220, 180, 0.12, 0.16, 'square');
      tone(220, 160, 0.14, 0.12, 'square', 0.14);
      break;
  }
}
