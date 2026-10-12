import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtSearchResult, Game, GameArt } from '@shared/types';
import { writeFileAtomic } from '../util/fsx';
import type { ArtKind, SteamGridDbClient } from './steamgriddb';

export const ART_SCHEME = 'arcadia-art';
const KINDS: ArtKind[] = ['grid', 'hero', 'logo'];
const RETRY_NOT_FOUND_MS = 7 * 24 * 3600 * 1000;
const KEY_RE = /^[a-z0-9-]{1,64}$/;

interface Entry {
  sourceId?: number;
  sourceName?: string;
  files: Partial<Record<ArtKind, string>>;
  fetchedAt: number;
  notFound?: boolean;
}

/** Art is shared by every dump of the same game: keyed by platform + game ID. */
export function artKey(game: Pick<Game, 'platform' | 'gameId' | 'id'>): string {
  return `${game.platform}-${(game.gameId ?? game.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 64);
}

/**
 * Downloaded artwork under userData/art/<key>/<kind>.<ext>, with an index.
 * The renderer loads it through the arcadia-art:// protocol.
 */
export class ArtStore {
  private index = new Map<string, Entry>();
  private readonly dir: string;

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'art');
  }

  async load(): Promise<void> {
    try {
      this.index = new Map(Object.entries(JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as Record<string, Entry>));
    } catch {
      this.index = new Map();
    }
  }

  private save(): Promise<void> {
    return writeFileAtomic(join(this.dir, 'index.json'), JSON.stringify(Object.fromEntries(this.index)));
  }

  artFor(game: Game): GameArt | null {
    const key = artKey(game);
    const e = this.index.get(key);
    if (!e || e.notFound) return null;
    const url = (kind: ArtKind): string | undefined => (e.files[kind] ? `${ART_SCHEME}://${key}/${kind}?v=${e.fetchedAt}` : undefined);
    const art: GameArt = {};
    for (const k of KINDS) {
      const u = url(k);
      if (u) art[k] = u;
    }
    if (e.sourceId !== undefined) art.sourceId = e.sourceId;
    if (e.sourceName) art.sourceName = e.sourceName;
    return art;
  }

  /** Resolve an arcadia-art://key/kind URL to a file path, or null. Rejects anything unexpected. */
  filePath(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const key = parsed.hostname;
    const kind = parsed.pathname.replace(/^\//, '') as ArtKind;
    if (!KEY_RE.test(key) || !KINDS.includes(kind)) return null;
    const file = this.index.get(key)?.files[kind];
    return file ? join(this.dir, key, file) : null;
  }

  needsFetch(game: Game, now = Date.now()): boolean {
    const e = this.index.get(artKey(game));
    if (!e) return true;
    return !!e.notFound && now - e.fetchedAt > RETRY_NOT_FOUND_MS;
  }

  private inflight = new Map<string, Promise<unknown>>();
  private stagingCounter = 0;

  /**
   * Find and download art. `sourceId` forces a specific SteamGridDB game (manual
   * match). Fetches for the same game run one after another, never interleaved.
   */
  fetch(game: Game, client: SteamGridDbClient, sourceId?: number): Promise<GameArt | null> {
    const key = artKey(game);
    const previous = this.inflight.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.fetchNow(game, client, sourceId));
    this.inflight.set(key, next);
    void next.finally(() => {
      if (this.inflight.get(key) === next) this.inflight.delete(key);
    }).catch(() => undefined);
    return next;
  }

  private async fetchNow(game: Game, client: SteamGridDbClient, sourceId?: number): Promise<GameArt | null> {
    const key = artKey(game);
    let match: ArtSearchResult | undefined;
    if (sourceId !== undefined) match = { id: sourceId, name: game.displayTitle, year: null };
    else match = (await client.search(game.displayTitle))[0];

    if (!match) {
      this.index.set(key, { files: {}, fetchedAt: Date.now(), notFound: true });
      await this.save();
      return null;
    }

    // Download into a staging folder; the current art is replaced only once
    // everything arrived, so a failed or interrupted fetch keeps what was there.
    const folder = join(this.dir, key);
    const staging = join(this.dir, `${key}.incoming-${process.pid}-${++this.stagingCounter}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const files: Entry['files'] = {};
    try {
      for (const kind of KINDS) {
        const asset = await client.asset(match.id, kind);
        if (!asset) continue;
        const { data, ext } = await client.download(asset.url);
        const name = `${kind}.${ext}`;
        await writeFile(join(staging, name), data);
        files[kind] = name;
      }
    } catch (err) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    await rm(folder, { recursive: true, force: true });
    await rename(staging, folder);
    this.index.set(key, { sourceId: match.id, sourceName: match.name, files, fetchedAt: Date.now(), ...(Object.keys(files).length ? {} : { notFound: true }) });
    await this.save();
    return this.artFor(game);
  }

  async clear(game: Game): Promise<void> {
    const key = artKey(game);
    this.index.delete(key);
    await rm(join(this.dir, key), { recursive: true, force: true });
    await this.save();
  }
}
