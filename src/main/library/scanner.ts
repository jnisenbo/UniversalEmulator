import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PLATFORM_INFO } from '@shared/platforms';
import type { Game, GameIdentity, ScanProgress, ScanSummary } from '@shared/types';
import type { CacheEntry, LibraryCache } from './cache';
import { isCandidate, probeFile, type ProbeContext } from './probes/index';
import { groupDiscs } from './discs';
import { titleFromPath } from './title';

const MAX_DEPTH = 8;
const CONCURRENCY = 4;
/** Below this, extensionless files can't be STFS packages and aren't worth opening. */
const MIN_STFS_SIZE = 0x1000;

interface Candidate {
  path: string;
  size: number;
  mtimeMs: number;
}

async function walk(root: string, out: Candidate[], errors: string[], depth = 0): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    errors.push(`${root}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH && !e.name.endsWith('.app')) await walk(full, out, errors, depth + 1);
    } else if (e.isFile() && isCandidate(e.name)) {
      try {
        const s = await stat(full);
        if (!e.name.includes('.') && s.size < MIN_STFS_SIZE) continue;
        out.push({ path: full, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        /* vanished mid-scan */
      }
    }
  }
}

export const gameIdForPath = (path: string): string => createHash('sha1').update(path).digest('hex').slice(0, 16);

export function toGame(c: Candidate, identity: GameIdentity): Game {
  return {
    ...identity,
    id: gameIdForPath(c.path),
    path: c.path,
    fileName: basename(c.path),
    displayTitle: identity.title ?? titleFromPath(c.path),
    sizeBytes: c.size,
    emulator: PLATFORM_INFO[identity.platform].emulator,
  };
}

/** Only base games appear in the library; updates/DLC are applied by the emulator. */
const listable = (g: Game): boolean => g.contentKind === undefined || g.contentKind === 'base';

export async function scanLibrary(
  folders: string[],
  cache: LibraryCache,
  ctx: ProbeContext,
  onProgress: (p: ScanProgress) => void,
): Promise<ScanSummary> {
  const errors: string[] = [];
  const candidates: Candidate[] = [];
  onProgress({ phase: 'walking', scanned: 0, total: 0 });
  for (const f of folders) await walk(f, candidates, errors);

  const before = cache.paths();
  const next = new Map<string, CacheEntry>();
  let scanned = 0;
  let lastEmit = 0;

  const queue = [...candidates];
  const worker = async (): Promise<void> => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const hit = cache.lookup(c.path, c.size, c.mtimeMs);
      let entry: CacheEntry;
      if (hit) {
        entry = hit;
      } else {
        try {
          const identity = await probeFile(c.path, ctx);
          entry = { size: c.size, mtimeMs: c.mtimeMs, game: identity ? toGame(c, identity) : null };
        } catch (err) {
          errors.push(`${c.path}: ${(err as Error).message}`);
          entry = { size: c.size, mtimeMs: c.mtimeMs, game: null };
        }
      }
      if (entry.game && !listable(entry.game)) entry = { ...entry, game: null };
      next.set(c.path, entry);
      scanned++;
      const now = Date.now();
      if (now - lastEmit > 100) {
        lastEmit = now;
        onProgress({ phase: 'probing', scanned, total: candidates.length, current: basename(c.path) });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  cache.replaceAll(next);
  await cache.save();
  const games = cache.games();
  onProgress({ phase: 'done', scanned, total: candidates.length });
  return {
    games: games.length,
    added: [...next.keys()].filter((p) => !before.has(p) && next.get(p)?.game).length,
    removed: [...before].filter((p) => !next.has(p)).length,
    unidentified: games.filter((g) => !g.identified).length,
    errors: errors.slice(0, 20),
  };
}

/** Group multi-disc games, then order by title (the renderer re-orders by play history). */
export function sortGames(games: Game[]): Game[] {
  return groupDiscs(games).sort((a, b) => a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' }) || a.discNumber - b.discNumber);
}
