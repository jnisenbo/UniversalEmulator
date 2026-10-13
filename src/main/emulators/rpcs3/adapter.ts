import { join } from 'node:path';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';
import { exists } from '../../util/fsx';

export const defaultRpcs3DataDir = (home: string): string => join(home, 'Library', 'Application Support', 'rpcs3');

/** RPCS3 can't boot anything until the PS3 system software is installed. */
const firmwareInstalled = (dataDir: string): Promise<boolean> => exists(join(dataDir, 'dev_flash', 'vsh', 'module', 'vsh.self'));

export const rpcs3Adapter: EmulatorAdapter = {
  id: 'rpcs3',
  platforms: ['ps3'],
  bundleNames: ['RPCS3.app', 'rpcs3.app'],

  installPath: (s) => s.emulators.rpcs3.appPath,

  async detect(ctx) {
    const { status } = await detectApp('rpcs3', ctx.settings.emulators.rpcs3.appPath);
    if (!(await firmwareInstalled(ctx.settings.emulators.rpcs3.dataDir ?? defaultRpcs3DataDir(ctx.home)))) {
      status.issues.push({
        level: 'error',
        message: 'Open RPCS3 once and install the PS3 system software (File → Install Firmware). It is a free download from PlayStation’s website.',
        fix: 'openEmulator',
      });
    }
    return status;
  },

  async writeConfig() {
    return { warnings: [] };
  },

  getLaunchArgs(game, app) {
    return { executable: app.executable, args: ['--no-gui', '--fullscreen', game.path] };
  },
};
