import { basename } from 'node:path';
import { PLATFORM_INFO, type Platform } from '@shared/platforms';
import type { Settings } from '@shared/settings';
import type { EmulatorStatus } from '@shared/types';
import { gatekeeperIssues, resolveApp } from '../platform/macos/bundle';
import type { EmulatorAdapter } from './adapter';
import { expandArgs } from './xenia/adapter';

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
      const status: EmulatorStatus = { id: PLATFORM_INFO[platform].emulator, configured: true, installPath: c.appPath, executable: null, version: null, arch: [], issues: [] };
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
      return { executable: app.executable, args: expandArgs(c.argsTemplate, game.path) };
    },
  };
}
