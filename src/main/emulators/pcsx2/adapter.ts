import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';
import { exists, writeFileAtomic } from '../../util/fsx';
import { parseIni, stringifyIni } from '../../util/ini';
import { patchPcsx2Ini, pcsx2Bios } from './config';

export const defaultPcsx2DataDir = (home: string): string => join(home, 'Library', 'Application Support', 'PCSX2');
const iniPath = (dataDir: string): string => join(dataDir, 'inis', 'PCSX2.ini');

export const pcsx2Adapter: EmulatorAdapter = {
  id: 'pcsx2',
  platforms: ['ps2'],
  bundleNames: ['PCSX2.app', 'PCSX2-v2.app'],

  installPath: (s) => s.emulators.pcsx2.appPath,

  async detect(ctx) {
    const { status } = await detectApp('pcsx2', ctx.settings.emulators.pcsx2.appPath);
    const file = iniPath(ctx.settings.emulators.pcsx2.dataDir ?? defaultPcsx2DataDir(ctx.home));
    const bios = (await exists(file)) ? pcsx2Bios(parseIni(await readFile(file, 'utf8'))) : null;
    if (!bios) {
      status.issues.push({ level: 'error', message: 'Open PCSX2 once and finish its setup with the BIOS dumped from your own PS2.', fix: 'openEmulator' });
    }
    return status;
  },

  /**
   * PCSX2 has no "use this config" flag, so Arcadia edits only the controller
   * and quit-prompt keys in the user's PCSX2.ini, after keeping one backup.
   */
  async writeConfig(ctx, profile) {
    const file = iniPath(ctx.settings.emulators.pcsx2.dataDir ?? defaultPcsx2DataDir(ctx.home));
    if (!(await exists(file))) throw new Error('Open PCSX2 once and finish its setup (BIOS) before launching PS2 games from Arcadia.');
    const backup = `${file}.arcadia-backup`;
    if (!(await exists(backup))) await copyFile(file, backup);
    const players = profile.multiplayer ? Math.max(1, ctx.controllers?.length ?? 1) : 1;
    await writeFileAtomic(file, stringifyIni(patchPcsx2Ini(parseIni(await readFile(file, 'utf8')), profile, players)));
    return { warnings: [] };
  },

  getLaunchArgs(game, app) {
    // -batch: PCSX2 quits when the game stops, so control returns to Arcadia.
    return { executable: app.executable, args: ['-batch', '-nogui', '-fullscreen', '--', game.path] };
  },
};
