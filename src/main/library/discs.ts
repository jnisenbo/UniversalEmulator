import type { Game } from '@shared/types';

import { titleFromPath } from './title';

const MULTI_DISC_PLATFORMS = new Set(['gamecube', 'wii', 'ps1']);

/**
 * GameCube/Wii discs of one game share a game ID. PS1 discs each have their
 * own serial, so they're matched by file name minus the "(Disc N)" tag.
 */
const groupKey = (g: Game): string | null =>
  g.platform === 'ps1' ? (g.discNumber > 0 ? `ps1|${titleFromPath(g.path).toLowerCase()}|${g.path.slice(0, g.path.lastIndexOf('/'))}` : null) : g.gameId ? `${g.platform}|${g.gameId}` : null;

/**
 * GameCube games that span discs share one game ID; the disc number differs.
 * Show them as one tile: the lowest disc is the entry, carrying every disc's
 * path in order so the emulator can swap discs itself. Extra copies of the
 * same disc (e.g. an .iso and an .rvz) stay separate.
 */
export function groupDiscs(games: Game[]): Game[] {
  const groups = new Map<string, Game[]>();
  const out: Game[] = [];
  for (const g of games) {
    const key = MULTI_DISC_PLATFORMS.has(g.platform) ? groupKey(g) : null;
    if (!key) {
      out.push(g);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(g);
    else groups.set(key, [g]);
  }
  for (const group of groups.values()) {
    const byDisc = new Map<number, Game>();
    const extras: Game[] = [];
    for (const g of [...group].sort((a, b) => a.path.localeCompare(b.path))) {
      if (byDisc.has(g.discNumber)) extras.push(g);
      else byDisc.set(g.discNumber, g);
    }
    const discs = [...byDisc.values()].sort((a, b) => a.discNumber - b.discNumber);
    if (discs.length > 1) out.push({ ...discs[0]!, discPaths: discs.map((d) => d.path) });
    else out.push(...discs);
    out.push(...extras);
  }
  return out;
}
