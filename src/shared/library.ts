import type { Platform } from './platforms';
import type { Game, PlayRecord } from './types';

/**
 * Identity of a game across dumps and folders: platform + its own ID, so moving
 * or re-dumping a game keeps its play time and per-game settings.
 */
export function gameKey(game: Pick<Game, 'platform' | 'gameId' | 'id'>): string {
  return game.gameId ? `${game.platform}-${game.gameId}`.toLowerCase() : game.id;
}

export type LibrarySort = 'recent' | 'title';
export type LibraryFilter = 'all' | Platform;

const byTitle = (a: Game, b: Game): number => a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' });

/** Recently played first (newest first), then everything else by title. */
export function arrangeLibrary(games: Game[], history: Record<string, PlayRecord>, sort: LibrarySort, filter: LibraryFilter): Game[] {
  const visible = filter === 'all' ? games : games.filter((g) => g.platform === filter);
  if (sort === 'title') return [...visible].sort(byTitle);
  return [...visible].sort((a, b) => {
    const la = history[gameKey(a)]?.lastPlayed ?? 0;
    const lb = history[gameKey(b)]?.lastPlayed ?? 0;
    return lb - la || byTitle(a, b);
  });
}

export function formatPlayTime(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Less than a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

export function formatLastPlayed(ts: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
