import { basename } from 'node:path';
import { PLATFORM_INFO, type EmulatorId, type Platform } from '@shared/platforms';
import type { Settings } from '@shared/settings';
import type { EmulatorStatus } from '@shared/types';
import { gatekeeperIssues, resolveApp } from '../platform/macos/bundle';
import type { EmulatorAdapter } from './adapter';
import { expandArgs } from './xenia/adapter';

/**
 * Opens the game in the app the way Finder does, then waits until the app
 * quits so Arcadia knows the game ended. Quitting from Arcadia's menu stops
 * the app. Paths come in the environment, so they never appear in this
 * script's own command line (pkill would otherwise match the script itself).
 */
export const OPEN_AND_WAIT_SCRIPT = `
trap 'pkill -TERM -f "$ARCADIA_APP/Contents/MacOS/"; exit 0' TERM INT
/usr/bin/open -W -a "$ARCADIA_APP" "$ARCADIA_GAME" &
wait $!
exit 0
`;

export type CustomEmulator = NonNullable<Settings['customEmulators'][Platform]>;

export const customLabel = (c: CustomEmulator): string => c.name.trim() || basename(c.appPath).replace(/\.app$/i, '');

/**
 * Any app the user chooses for a console. Arcadia launches it with the
 * argument template ({game} = the game's path) and doesn't touch its config.
 */
export function customAdapter(platform: Platform, c: CustomEmulator): EmulatorAdapter {
  const label = customLabel(c);
  return {
    // Keeps the console's normal emulator id so play history and the in-game menu work as usual.
    id: PLATFORM_INFO[platform].emulator,
    platforms: [platform],
    bundleNames: [],
    installPath: () => c.appPath,

    async detect() {
      const status: EmulatorStatus = { id: PLATFORM_INFO[platform].emulator as EmulatorId, configured: true, installPath: c.appPath, executable: null, version: null, arch: [], issues: [] };
      try {
        const app = await resolveApp(c.appPath);
        Object.assign(status, { executable: app.executable, version: app.version, arch: app.arch });
        status.issues.push(...(await gatekeeperIssues(app, label)));
      } catch (err) {
        status.issues.push({ level: 'error', message: `Couldn't open ${label} at ${c.appPath}: ${(err as Error).message}` });
      }
      return status;
    },

    async writeConfig() {
      return { warnings: [] };
    },

    getLaunchArgs(game, app) {
      if (c.launch === 'args') return { executable: app.executable, args: expandArgs(c.argsTemplate, game.path) };
      return {
        executable: '/bin/sh',
        args: ['-c', OPEN_AND_WAIT_SCRIPT],
        env: { ARCADIA_APP: c.appPath.replace(/\/+$/, ''), ARCADIA_GAME: game.path },
      };
    },
  };
}
