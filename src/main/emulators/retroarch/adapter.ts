import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Platform } from '@shared/platforms';
import type { Settings } from '@shared/settings';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';

export const defaultRetroArchDataDir = (home: string): string => join(home, 'Library', 'Application Support', 'RetroArch');

/** Cores tried in order for each console (file names without "_libretro.dylib"). */
export const CORES: Partial<Record<Platform, { names: string[]; label: string }>> = {
  ps1: { names: ['swanstation', 'pcsx_rearmed', 'mednafen_psx_hw', 'mednafen_psx'], label: 'SwanStation or PCSX ReARMed' },
  n64: { names: ['mupen64plus_next', 'parallel_n64'], label: 'Mupen64Plus-Next' },
  snes: { names: ['snes9x', 'bsnes', 'bsnes_hd_beta'], label: 'Snes9x' },
  nes: { names: ['mesen', 'nestopia', 'fceumm'], label: 'Mesen or Nestopia' },
  gba: { names: ['mgba', 'vba_next'], label: 'mGBA' },
  gb: { names: ['sameboy', 'gambatte', 'mgba'], label: 'SameBoy or Gambatte' },
  genesis: { names: ['genesis_plus_gx', 'picodrive'], label: 'Genesis Plus GX' },
};

/** RetroArch's cores folder: libretro_directory from retroarch.cfg, else the default. */
export function coresDir(s: Settings, home: string): string {
  const dataDir = s.emulators.retroarch.dataDir ?? defaultRetroArchDataDir(home);
  for (const cfg of [join(dataDir, 'config', 'retroarch.cfg'), join(dataDir, 'retroarch.cfg')]) {
    try {
      const m = /^\s*libretro_directory\s*=\s*"([^"]*)"/m.exec(readFileSync(cfg, 'utf8'));
      const dir = m?.[1]?.replace(/^~(?=\/|$)/, home);
      if (dir && dir !== 'default' && existsSync(dir)) return dir;
    } catch {
      /* no config yet */
    }
  }
  return join(dataDir, 'cores');
}

const playlistPath = (game: { id: string }, managedDir: string): string => join(managedDir, 'Playlists', `${game.id}.m3u`);

export function findCore(platform: Platform, dir: string): string | null {
  for (const name of CORES[platform]?.names ?? []) {
    const p = join(dir, `${name}_libretro.dylib`);
    if (existsSync(p)) return p;
  }
  return null;
}

export const retroarchAdapter: EmulatorAdapter = {
  id: 'retroarch',
  platforms: ['ps1', 'n64', 'snes', 'nes', 'gba', 'gb', 'genesis'],
  bundleNames: ['RetroArch.app'],

  installPath: (s) => s.emulators.retroarch.appPath,

  async detect(ctx) {
    const { status } = await detectApp('retroarch', ctx.settings.emulators.retroarch.appPath);
    const dir = coresDir(ctx.settings, ctx.home);
    const missing = (Object.keys(CORES) as Platform[]).filter((p) => !findCore(p, dir));
    if (missing.length === Object.keys(CORES).length) {
      status.issues.push({ level: 'warn', message: 'No RetroArch cores yet. Open RetroArch → Load Core → Download a Core, and get the ones for your consoles.', fix: 'openEmulator' });
    }
    return status;
  },

  async writeConfig() {
    return { warnings: [] };
  },

  async prepareGame(game, ctx) {
    if (!findCore(game.platform, coresDir(ctx.settings, ctx.home))) {
      throw new Error(`RetroArch needs the ${CORES[game.platform]?.label ?? ''} core for this game. Open RetroArch → Load Core → Download a Core and get it, then try again.`);
    }
    // Multi-disc games boot from an .m3u so the core can swap discs (RetroArch: Quick Menu → Disc Control).
    if (game.discPaths) {
      await mkdir(join(ctx.managedDir, 'Playlists'), { recursive: true });
      await writeFile(playlistPath(game, ctx.managedDir), game.discPaths.join('\n') + '\n');
    }
  },

  getLaunchArgs(game, app, ctx) {
    const core = findCore(game.platform, coresDir(ctx.settings, ctx.home));
    const boot = game.discPaths ? playlistPath(game, ctx.managedDir) : game.path;
    return { executable: app.executable, args: ['-f', ...(core ? ['-L', core] : []), boot] };
  },
};
