import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { PAD_LABEL } from '@shared/controls';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';
import { exists, writeFileAtomic } from '../../util/fsx';
import { patchXemuConfig } from './config';

/** SDL_GetPrefPath("xemu", "xemu") on macOS. */
export const defaultXemuDataDir = (home: string): string => join(home, 'Library', 'Application Support', 'xemu', 'xemu');
const CONFIG = 'xemu.toml';

export const xemuAdapter: EmulatorAdapter = {
  id: 'xemu',
  platforms: ['xbox'],
  bundleNames: ['xemu.app'],

  installPath: (s) => s.emulators.xemu.appPath,

  async detect(ctx) {
    const { status } = await detectApp('xemu', ctx.settings.emulators.xemu.appPath);
    const dataDir = ctx.settings.emulators.xemu.dataDir ?? defaultXemuDataDir(ctx.home);
    if (!(await exists(join(dataDir, CONFIG)))) {
      status.issues.push({ level: 'error', message: `Open xemu once and set your BIOS, flash and hard disk image files from your own console (looked in ${dataDir}).`, fix: 'openEmulator' });
    }
    return status;
  },

  /**
   * xemu runs with -config_path pointing at a patched copy of the user's
   * xemu.toml, regenerated each launch. The user's file is never written.
   */
  async writeConfig(ctx, profile) {
    const source = join(ctx.settings.emulators.xemu.dataDir ?? defaultXemuDataDir(ctx.home), CONFIG);
    if (!(await exists(source))) throw new Error('Open xemu once and set up your BIOS and hard disk files before launching Xbox games from Arcadia.');
    const { config, mappingsUpdated, missingFiles, skippedButtons } = patchXemuConfig(parse(await readFile(source, 'utf8')), profile, ctx.settings.graphics);
    if (missingFiles.length) throw new Error(`xemu is missing ${missingFiles.join(', ')}. Set them in xemu → Machine → System.`);
    await mkdir(ctx.managedDir, { recursive: true });
    await writeFileAtomic(join(ctx.managedDir, CONFIG), stringify(config));

    const warnings: string[] = [];
    if (mappingsUpdated === 0 && Object.keys(profile.layout).length) {
      warnings.push('To use your button layout in xemu: go to Settings → Emulators → xemu → Open xemu (not during a game), open Input with your controller connected, then quit. Arcadia applies your layout from then on.');
    }
    if (skippedButtons.length) warnings.push(`xemu can't move these to the buttons you chose: ${skippedButtons.map((b) => PAD_LABEL[b]).join(', ')}.`);
    return { warnings };
  },

  getLaunchArgs(game, app, ctx) {
    return { executable: app.executable, args: ['-config_path', join(ctx.managedDir, CONFIG), '-dvd_path', game.path] };
  },
};
