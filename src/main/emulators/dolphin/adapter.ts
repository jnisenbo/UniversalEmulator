import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game } from '@shared/types';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';
import { ensureSymlink, exists, writeFileAtomic } from '../../util/fsx';
import { parseIni, stringifyIni } from '../../util/ini';
import { applyDolphinIni, applyGfxIni, dolphinPlayers, gcPadIni, wiimoteIni } from './config';

/** Folders shared with the user's normal Dolphin setup so saves stay in one place. */
const SHARED_DIRS = ['GC', 'Wii', 'StateSaves', 'Load', 'ScreenShots'];

/** Disc IDs come from file headers; keep only safe characters for the file name. */
const playlistPath = (game: Game, managedDir: string): string =>
  join(managedDir, 'Playlists', `${(game.gameId ?? game.id).replace(/[^A-Za-z0-9]/g, '_')}.m3u`);

const defaultDataDir = (home: string): string => join(home, 'Library', 'Application Support', 'Dolphin');

export const dolphinAdapter: EmulatorAdapter = {
  id: 'dolphin',
  platforms: ['wii', 'gamecube'],
  bundleNames: ['Dolphin.app'],

  installPath: (s) => s.emulators.dolphin.appPath,

  async detect(ctx) {
    const { status } = await detectApp('dolphin', ctx.settings.emulators.dolphin.appPath);
    return status;
  },

  /**
   * Arcadia runs Dolphin with its own user folder (-u). Config/ is ours;
   * saves, NAND and state folders are symlinked to the normal Dolphin folder.
   */
  async writeConfig(ctx, profile, game) {
    const warnings: string[] = [];
    const userDir = ctx.managedDir;
    const configDir = join(userDir, 'Config');
    await mkdir(configDir, { recursive: true });

    const realDir = ctx.settings.emulators.dolphin.dataDir ?? defaultDataDir(ctx.home);
    if (await exists(realDir)) {
      for (const d of SHARED_DIRS) {
        const src = join(realDir, d);
        if (await exists(src)) await ensureSymlink(src, join(userDir, d));
      }
    } else {
      warnings.push(`Dolphin's normal data folder wasn't found at ${realDir}; saves will live in Arcadia's copy.`);
    }

    const players = dolphinPlayers(profile, ctx.controllers);
    const iniPath = join(configDir, 'Dolphin.ini');
    const current = (await exists(iniPath)) ? parseIni(await readFile(iniPath, 'utf8')) : new Map();
    await writeFileAtomic(iniPath, stringifyIni(applyDolphinIni(current, players.length)));
    const gfxPath = join(configDir, 'GFX.ini');
    const gfx = (await exists(gfxPath)) ? parseIni(await readFile(gfxPath, 'utf8')) : new Map();
    await writeFileAtomic(gfxPath, stringifyIni(applyGfxIni(gfx, ctx.settings.graphics)));
    await writeFileAtomic(join(configDir, 'GCPadNew.ini'), stringifyIni(gcPadIni(profile, players)));
    await writeFileAtomic(join(configDir, 'WiimoteNew.ini'), stringifyIni(wiimoteIni(profile, players, game?.gameId)));
    return { warnings };
  },

  /** Multi-disc games boot from an .m3u so Dolphin can change discs when the game asks. */
  async prepareGame(game, ctx) {
    if (!game.discPaths) return;
    await writeFileAtomic(playlistPath(game, ctx.managedDir), game.discPaths.join('\n') + '\n');
  },

  getLaunchArgs(game, app, ctx) {
    const boot = game.discPaths ? playlistPath(game, ctx.managedDir) : game.path;
    return {
      executable: app.executable,
      // -b: batch mode, Dolphin exits when emulation stops → control returns to Arcadia.
      args: ['-u', ctx.managedDir, '-b', '-e', boot, '-C', 'Dolphin.Display.Fullscreen=True'],
    };
  },
};
