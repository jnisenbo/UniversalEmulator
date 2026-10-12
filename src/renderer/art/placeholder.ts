import { PLATFORM_INFO } from '@shared/platforms';
import type { Game } from '@shared/types';

/** Deterministic 0..1 values from a string, so a game always gets the same art. */
function hashFloats(key: string, n: number): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < key.length; j++) h = Math.imul(h ^ key.charCodeAt(j) ^ i, 16777619);
    out.push(((h >>> 0) % 10007) / 10007);
  }
  return out;
}

export interface Art {
  tile: string;
  hero: string;
  accent: string;
}

/**
 * Placeholder art until Phase 3 brings real covers: layered gradients in the
 * platform's hue, varied per game so neighbouring tiles read as different.
 */
export function placeholderArt(game: Pick<Game, 'platform' | 'gameId' | 'path'>): Art {
  const [a = 0, b = 0, c = 0, d = 0] = hashFloats(game.gameId ?? game.path, 4);
  const hue = PLATFORM_INFO[game.platform].hue + (a - 0.5) * 50;
  const hue2 = hue + 30 + b * 60;
  const accent = `hsl(${hue} 80% 62%)`;
  const tile = [
    `radial-gradient(120% 90% at ${20 + c * 60}% ${10 + d * 30}%, hsl(${hue2} 85% 62% / 0.85), transparent 60%)`,
    `radial-gradient(90% 80% at ${80 - c * 40}% 100%, hsl(${hue} 90% 45% / 0.9), transparent 70%)`,
    `linear-gradient(160deg, hsl(${hue} 55% 22%), hsl(${hue2} 60% 10%))`,
  ].join(', ');
  const hero = [
    `radial-gradient(70% 90% at ${70 + c * 20}% ${25 + d * 20}%, hsl(${hue2} 80% 50% / 0.55), transparent 65%)`,
    `radial-gradient(60% 70% at ${15 + a * 20}% 85%, hsl(${hue} 85% 40% / 0.5), transparent 70%)`,
    `linear-gradient(120deg, hsl(${hue} 45% 9%), hsl(${hue2} 50% 6%))`,
  ].join(', ');
  return { tile, hero, accent };
}

/** Two-letter monogram for tiles without art. */
export function monogram(title: string): string {
  const words = title.replace(/^(the|a)\s+/i, '').split(/[\s:–-]+/).filter((w) => /[a-z0-9]/i.test(w));
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}
