import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Platform } from '@shared/platforms';
import { readAppInfo } from '../library/probes/macapp';
import { run } from '../util/exec';
import type { Game } from '@shared/types';
import type { ArtKind, Fetch, SteamGridDbClient } from './steamgriddb';

export interface FoundArt {
  provider: string;
  sourceId?: number;
  sourceName?: string;
  /** Image URL per kind. */
  assets: Partial<Record<ArtKind, string>>;
  /** Portrait box art (shown whole on tiles instead of cropped). */
  boxArt?: boolean;
}

export interface ArtProvider {
  id: string;
  find(game: Game, sourceId?: number): Promise<FoundArt | null>;
  download(url: string): Promise<{ data: Buffer; ext: string }>;
}

export function steamGridDbProvider(client: SteamGridDbClient): ArtProvider {
  return {
    id: 'steamgriddb',
    async find(game, sourceId) {
      const match = sourceId !== undefined ? { id: sourceId, name: game.displayTitle } : (await client.search(game.displayTitle))[0];
      if (!match) return null;
      const assets: FoundArt['assets'] = {};
      for (const kind of ['grid', 'hero', 'logo'] as ArtKind[]) {
        const a = await client.asset(match.id, kind);
        if (a) assets[kind] = a.url;
      }
      return { provider: 'steamgriddb', sourceId: match.id, sourceName: match.name, assets };
    },
    download: (url) => client.download(url),
  };
}

/** libretro-thumbnails folder per console (box art named after No-Intro / Redump titles). */
export const LIBRETRO_SYSTEM: Partial<Record<Platform, string>> = {
  gamecube: 'Nintendo - GameCube',
  wii: 'Nintendo - Wii',
  xbox: 'Microsoft - Xbox',
  xbox360: 'Microsoft - Xbox 360',
  ps1: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  ps3: 'Sony - PlayStation 3',
  n64: 'Nintendo - Nintendo 64',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  nes: 'Nintendo - Nintendo Entertainment System',
  gba: 'Nintendo - Game Boy Advance',
  gb: 'Nintendo - Game Boy',
  genesis: 'Sega - Mega Drive - Genesis',
};
const LIBRETRO = 'https://thumbnails.libretro.com';

/** GameTDB cover regions from the 4th character of a GameCube/Wii disc ID. */
function gametdbRegions(id: string): string[] {
  switch (id[3]) {
    case 'E': case 'N': return ['US', 'EN'];
    case 'P': case 'X': case 'Y': return ['EN', 'US', 'FR', 'DE'];
    case 'J': return ['JA', 'US'];
    case 'K': return ['KO', 'US'];
    case 'D': return ['DE', 'EN'];
    case 'F': return ['FR', 'EN'];
    default: return ['US', 'EN', 'JA'];
  }
}

/** Lowercase words only, no articles or region tags: "Legend of Zelda, The - Twilight Princess (USA)" → "legend of zelda twilight princess". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const REGION_RANK = (name: string): number => (/\(USA/.test(name) ? 0 : /\(World/.test(name) ? 1 : /\(Europe/.test(name) ? 2 : 3);

/** Best libretro file name for a title, or null. Exact match first, then close word overlap. */
export function bestLibretroMatch(title: string, files: string[]): string | null {
  const want = normalizeTitle(title);
  if (!want) return null;
  const wantWords = new Set(want.split(' '));
  let best: { file: string; score: number } | null = null;
  for (const file of files) {
    const base = file.replace(/\.png$/i, '');
    const norm = normalizeTitle(base);
    let score: number;
    if (norm === want) score = 10;
    else {
      const words = norm.split(' ');
      const common = words.filter((w) => wantWords.has(w)).length;
      const union = new Set([...words, ...wantWords]).size;
      score = union ? (common / union) * 9 : 0;
      if (score < 7) continue;
    }
    score -= REGION_RANK(base) * 0.01;
    if (!best || score > best.score) best = { file, score };
  }
  return best?.file ?? null;
}

/**
 * Free box art, no account needed: GameTDB (GameCube/Wii, by disc ID), the
 * Xbox 360 marketplace (by title ID), then libretro-thumbnails (by title).
 */
export function freeCoverProvider(fetchFn: Fetch): ArtProvider {
  const listings = new Map<string, Promise<string[]>>();

  const listing = (system: string): Promise<string[]> => {
    let p = listings.get(system);
    if (!p) {
      p = (async () => {
        const res = await fetchFn(`${LIBRETRO}/${encodeURIComponent(system)}/Named_Boxarts/`);
        if (!res.ok) throw new Error(`libretro listing ${res.status}`);
        const html = new TextDecoder().decode(await res.arrayBuffer());
        return [...html.matchAll(/href="([^"?/]+\.png)"/gi)].map((m) => decodeURIComponent(m[1]!));
      })();
      p.catch(() => listings.delete(system));
      listings.set(system, p);
    }
    return p;
  };

  /** false = not there; a network failure throws, so the game is retried later. */
  const isImage = async (url: string): Promise<boolean> => {
    const res = await fetchFn(url, { method: 'HEAD' });
    return res.ok && (res.headers.get('content-type') ?? 'image/').startsWith('image/');
  };
  /** The Xbox store's images are a best-effort source: a failure there just moves on. */
  const maybeImage = (url: string): Promise<boolean> => isImage(url).catch(() => false);

  return {
    id: 'free',
    async find(game) {
      const id = game.gameId?.toUpperCase() ?? '';
      if ((game.platform === 'gamecube' || game.platform === 'wii') && /^[A-Z0-9]{6}$/.test(id)) {
        for (const region of gametdbRegions(id)) {
          const url = `https://art.gametdb.com/wii/cover/${region}/${id}.png`;
          if (await isImage(url)) return { provider: 'gametdb', sourceName: game.displayTitle, assets: { grid: url }, boxArt: true };
        }
      }
      if (game.platform === 'xbox360' && /^[0-9A-F]{8}$/.test(id)) {
        const url = `https://download.xbox.com/content/images/66acd000-77fe-1000-9115-d802${id.toLowerCase()}/1033/boxartlg.jpg`;
        if (await maybeImage(url)) return { provider: 'xbox', sourceName: game.displayTitle, assets: { grid: url }, boxArt: true };
      }
      const system = LIBRETRO_SYSTEM[game.platform];
      if (system) {
        const file = bestLibretroMatch(game.displayTitle, await listing(system));
        if (file) {
          return {
            provider: 'libretro',
            sourceName: file.replace(/\.png$/i, ''),
            assets: { grid: `${LIBRETRO}/${encodeURIComponent(system)}/Named_Boxarts/${encodeURIComponent(file)}` },
            boxArt: true,
          };
        }
      }
      return null;
    },
    async download(url) {
      if (!url.startsWith('https://')) throw new Error('Refusing non-https image URL');
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Image download failed (${res.status})`);
      const type = res.headers.get('content-type') ?? '';
      const ext = type.includes('png') || url.endsWith('.png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      return { data: Buffer.from(await res.arrayBuffer()), ext };
    },
  };
}

/**
 * Mac games: the app's own icon, used when nothing better was found.
 * macOS's `sips` turns the .icns into a 512px PNG.
 */
export function appIconProvider(workDir: string): ArtProvider {
  return {
    id: 'app-icon',
    async find(game) {
      if (game.platform !== 'mac' || process.platform !== 'darwin') return null;
      const { iconFile } = await readAppInfo(game.path);
      const name = iconFile ? (iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`) : 'AppIcon.icns';
      const icon = join(game.path, 'Contents', 'Resources', name);
      if (!(await stat(icon).catch(() => null))) return null;
      return { provider: 'app-icon', sourceName: game.displayTitle, assets: { grid: `file://${icon}` }, boxArt: true };
    },
    async download(url) {
      const icon = url.slice('file://'.length);
      await mkdir(workDir, { recursive: true });
      const out = join(workDir, `icon-${process.pid}-${Date.now()}.png`);
      const r = await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '512', icon, '--out', out]);
      if (r.code !== 0) throw new Error(`Couldn't read the app icon: ${r.stderr.trim() || r.stdout.trim()}`);
      try {
        return { data: await readFile(out), ext: 'png' };
      } finally {
        await rm(out, { force: true });
      }
    },
  };
}
