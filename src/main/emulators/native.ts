import type { EmulatorStatus } from '@shared/types';
import { gatekeeperIssues, resolveApp } from '../platform/macos/bundle';
import type { EmulatorAdapter } from './adapter';

/**
 * Native Mac games: Arcadia starts the game app itself, waits for it to quit,
 * then comes back. No emulator and no config to write.
 */
export const nativeAdapter = (appPath: string): EmulatorAdapter => ({
  id: 'native',
  platforms: ['mac'],
  bundleNames: [],
  installPath: () => appPath,

  async detect() {
    const status = { id: 'native', configured: true, installPath: appPath, executable: null, version: null, arch: [], issues: [] } as unknown as EmulatorStatus;
    try {
      const app = await resolveApp(appPath);
      Object.assign(status, { executable: app.executable, version: app.version, arch: app.arch });
      status.issues.push(...(await gatekeeperIssues(app, 'This game')));
    } catch (err) {
      status.issues.push({ level: 'error', message: `Couldn't open this game at ${appPath}: ${(err as Error).message}` });
    }
    return status;
  },

  async writeConfig() {
    return { warnings: [] };
  },

  getLaunchArgs(_game, app) {
    return { executable: app.executable, args: [] };
  },
});
