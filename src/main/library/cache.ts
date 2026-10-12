import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game } from '@shared/types';
import { writeFileAtomic } from '../util/fsx';

interface CacheEntry {
  size: number;
  mtimeMs: number;
  /** null = probed and not a game (e.g. an STFS save) so it isn't re-read. */
  game: Game | null;
  /** For probes that depend on outside input (Switch keys): what they were read with. */
  probeTag?: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/** Probe results keyed by path, invalidated by size + mtime. */
export class LibraryCache {
  private entries = new Map<string, CacheEntry>();
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'library.json');
  }

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as CacheFile;
      if (data.version === 1) this.entries = new Map(Object.entries(data.entries));
    } catch {
      this.entries = new Map();
    }
  }

  lookup(path: string, size: number, mtimeMs: number, probeTag?: string): CacheEntry | undefined {
    const e = this.entries.get(path);
    return e && e.size === size && e.mtimeMs === mtimeMs && e.probeTag === probeTag ? e : undefined;
  }

  replaceAll(entries: Map<string, CacheEntry>): void {
    this.entries = entries;
  }

  games(): Game[] {
    return [...this.entries.values()].flatMap((e) => (e.game ? [e.game] : []));
  }

  paths(): Set<string> {
    return new Set(this.entries.keys());
  }

  async save(): Promise<void> {
    const data: CacheFile = { version: 1, entries: Object.fromEntries(this.entries) };
    await writeFileAtomic(this.file, JSON.stringify(data));
  }
}

export type { CacheEntry };
