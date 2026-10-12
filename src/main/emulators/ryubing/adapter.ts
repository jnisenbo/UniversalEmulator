import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';
import { ensureSymlink, exists, writeFileAtomic } from '../../util/fsx';
import { patchRyubingConfig } from './config';

const CONFIG = 'Config.json';

export const defaultRyubingDataDir = (home: string): string => join(home, 'Library', 'Application Support', 'Ryujinx');

export const ryubingAdapter: EmulatorAdapter = {
  id: 'ryubing',
  platforms: ['switch'],
  bundleNames: ['Ryujinx.app', 'Ryubing.app'],

  installPath: (s) => s.emulators.ryubing.appPath,

  async detect(ctx) {
    const { status } = await detectApp('ryubing', ctx.settings.emulators.ryubing.appPath);
    const dataDir = ctx.settings.emulators.ryubing.dataDir ?? defaultRyubingDataDir(ctx.home);
    if (!(await exists(join(dataDir, CONFIG)))) {
      status.issues.push({ level: 'error', message: `Open Ryubing once so it creates its data folder (${dataDir}).`, fix: 'openEmulator' });
    } else if (!(await exists(join(dataDir, 'system', 'prod.keys')))) {
      status.issues.push({ level: 'error', message: 'Ryubing has no prod.keys yet. Install the keys and firmware dumped from your own Switch through Ryubing.', fix: 'openEmulator' });
    }
    return status;
  },

  /**
   * Arcadia's Ryubing root (-r) symlinks every entry of the real data folder
   * (keys, firmware, saves, mods) except Config.json, which is a patched copy
   * regenerated each launch so changes made in Ryubing itself carry over.
   */
  async writeConfig(ctx, profile) {
    const realDir = ctx.settings.emulators.ryubing.dataDir ?? defaultRyubingDataDir(ctx.home);
    const sourceConfig = join(realDir, CONFIG);
    if (!(await exists(sourceConfig))) {
      throw new Error('Open Ryubing once (and install your keys and firmware) before launching Switch games from Arcadia.');
    }
    await mkdir(ctx.managedDir, { recursive: true });
    for (const entry of await readdir(realDir)) {
      if (entry === CONFIG || entry === 'Logs') continue;
      await ensureSymlink(join(realDir, entry), join(ctx.managedDir, entry));
    }

    const source = JSON.parse(await readFile(sourceConfig, 'utf8')) as Record<string, unknown>;
    const { config, controllersUpdated, missingKeys } = patchRyubingConfig(source, profile, ctx.settings.graphics);
    await writeFileAtomic(join(ctx.managedDir, CONFIG), JSON.stringify(config, null, 2));

    const warnings: string[] = [];
    if (controllersUpdated === 0) {
      warnings.push('Select your controller once in Ryubing → Options → Settings → Input, then Arcadia will keep its mapping in sync.');
    }
    if (missingKeys.length) warnings.push(`This Ryubing version doesn't have: ${missingKeys.join(', ')}.`);
    return { warnings };
  },

  getLaunchArgs(game, app, ctx) {
    // -r: root data dir, -f: start fullscreen. Ryubing returns to its game list when a game
    // stops rather than exiting, so Arcadia ends the session with the quit gesture.
    return { executable: app.executable, args: ['-r', ctx.managedDir, '-f', game.path] };
  },
};
