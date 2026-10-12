import { onFrame } from './loop';

/**
 * Spring parameterized the way Apple's design talks do:
 *   damping  1.0 = critically damped (no overshoot), < 1 = bouncy
 *   response seconds to (approximately) reach the target; not a duration
 * Retargeting keeps the current value *and* velocity, so rapid inputs blend
 * instead of restarting.
 */
export interface SpringConfig {
  damping: number;
  response: number;
}

export const SPRINGS = {
  /** Default for everything focus-driven. */
  smooth: { damping: 1, response: 0.35 },
  snappy: { damping: 1, response: 0.25 },
  /** Only after real momentum (stick flick). */
  momentum: { damping: 0.82, response: 0.4 },
  /** Large surfaces (launch zoom). */
  surface: { damping: 1, response: 0.45 },
} satisfies Record<string, SpringConfig>;

let reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (reducedMotion = e.matches));
}
export const prefersReducedMotion = (): boolean => reducedMotion;

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private stiffness = 0;
  private dampingCoeff = 0;

  constructor(initial: number, config: SpringConfig = SPRINGS.smooth) {
    this.value = initial;
    this.target = initial;
    this.configure(config);
  }

  configure({ damping, response }: SpringConfig): void {
    // Unit mass: k = (2π / response)², c = 4π·ζ / response
    this.stiffness = (2 * Math.PI / response) ** 2;
    this.dampingCoeff = (4 * Math.PI * damping) / response;
  }

  setTarget(target: number, opts: { velocity?: number; config?: SpringConfig } = {}): void {
    this.target = target;
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    if (opts.config) this.configure(opts.config);
  }

  jump(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.01;
  }

  step(dt: number): number {
    if (reducedMotion) {
      // Reduced motion: no travel, no overshoot. Consumers cross-fade instead.
      this.jump(this.target);
      return this.value;
    }
    // Semi-implicit Euler with small substeps: stable for stiff, snappy springs.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.dampingCoeff * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    if (this.settled) this.jump(this.target);
    return this.value;
  }
}

/** Drive a spring on the shared loop and write its value straight to the DOM (no React renders per frame). */
export function animateSpring(spring: Spring, apply: (v: number) => void): () => void {
  let lastApplied = Number.NaN;
  return onFrame('animate', (dt) => {
    if (spring.settled && spring.value === lastApplied) return;
    const v = spring.step(dt);
    if (v !== lastApplied) {
      lastApplied = v;
      apply(v);
    }
  });
}

/** Apple's momentum projection (Designing Fluid Interfaces): where a flick would come to rest. */
export function project(velocityPxPerSec: number, decelerationRate = 0.99): number {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past an edge. */
export function rubberband(overshoot: number, dimension: number, c = 0.55): number {
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}
