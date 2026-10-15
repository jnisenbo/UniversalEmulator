import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface SteamGame {
  appId: string;
  name: string;
  /** steamapps/common/<installdir> */
  installDir: string;
  /** The game's .app inside the install folder. */
  appPath: string;
}

export const steamRoot = (home: string): string => join(home, 'Library', 'Application Support', 'Steam');

/** Values of "key" "value" pairs in Valve's KeyValues text (good enough for these files). */
function kv(text: string, key: string): string[] {
  return [...text.matchAll(new RegExp(`"${key}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'gi'))].map((m) => m[1]!.replace(/\\\\/g, '\\'));
}

/** Steam's own tools and runtimes aren't games. */
const NOT_GAMES = /steamworks|redistributable|proton|steam linux runtime|soundtrack|dedicated server|\bsdk\b/i;
const HELPER_APP = /uninstall|crash|report|updater|helper|launcher-?helper|setup|install|redist/i;

/** The most likely game app in an install folder: shallowest, not a helper, closest to the game's name. */
async function findGameApp(dir: string, name: string): Promise<string | null> {
  const want = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best: { path: string; score: number } | null = null;
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.name.endsWith('.app')) {
        if (HELPER_APP.test(e.name)) continue;
        const short = e.name.replace(/\.app$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const score = 10 - depth * 2 + (short && (want.includes(short) || short.includes(want)) ? 5 : 0);
        if (!best || score > best.score) best = { path: p, score };
      } else await walk(p, depth + 1);
    }
  };
  await walk(dir, 0);
  return (best as { path: string } | null)?.path ?? null;
}

/** Installed Steam games that have a Mac app, across every Steam library folder. */
export async function findSteamGames(home: string): Promise<SteamGame[]> {
  const root = steamRoot(home);
  const libraries = new Set([root]);
  const vdf = await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
  for (const p of kv(vdf, 'path')) libraries.add(p);

  const games: SteamGame[] = [];
  for (const lib of libraries) {
    const steamapps = join(lib, 'steamapps');
    const files = await readdir(steamapps).catch(() => [] as string[]);
    for (const f of files.filter((x) => /^appmanifest_\d+\.acf$/.test(x))) {
      const text = await readFile(join(steamapps, f), 'utf8').catch(() => '');
      const appId = kv(text, 'appid')[0];
      const name = kv(text, 'name')[0];
      const installdir = kv(text, 'installdir')[0];
      const flags = Number(kv(text, 'StateFlags')[0] ?? '0');
      if (!appId || !name || !installdir || !(flags & 4) || NOT_GAMES.test(name)) continue;
      const installDir = join(steamapps, 'common', installdir);
      if (!(await stat(installDir).catch(() => null))) continue;
      const appPath = await findGameApp(installDir, name);
      if (appPath) games.push({ appId, name, installDir, appPath });
    }
  }
  return games;
}

/**
 * Starts a Steam game through Steam (so its DRM and overlay work) and stays
 * running while any process from the game's folder is running. That lets
 * Arcadia know when you quit. On quit from Arcadia it closes the game.
 * The folder comes in ARCADIA_GAME_DIR so it never appears in this script's
 * own command line (which the process search would otherwise match).
 */
export const STEAM_WATCH_SCRIPT = `
find_game() { ps -axo pid=,command= | awk 'index($0, ENVIRON["ARCADIA_GAME_DIR"]) { print $1 }'; }
trap 'find_game | xargs kill 2>/dev/null; exit 0' TERM INT
/usr/bin/open "steam://rungameid/$ARCADIA_STEAM_APPID"
i=0
while [ -z "$(find_game)" ]; do
  i=$((i+1))
  if [ $i -gt 120 ]; then echo "The game didn't start within 2 minutes. Check that Steam is open and signed in." >&2; exit 3; fi
  sleep 1
done
while [ -n "$(find_game)" ]; do sleep 2; done
exit 0
`;
