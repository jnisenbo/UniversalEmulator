import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bufferReader } from '../src/main/library/probes/io';
import { parseSfo, probeChd, probeCso, probePlayStationDisc, probePs3Folder, serialFromSystemCnf } from '../src/main/library/probes/playstation';
import { probeRom } from '../src/main/library/probes/retro';
import { isCandidate } from '../src/main/library/probes/index';
import { bestLibretroMatch, normalizeTitle } from '../src/main/art/providers';
import { pcsx2Pad, patchPcsx2Ini, pcsx2Bios } from '../src/main/emulators/pcsx2/config';
import { findCore } from '../src/main/emulators/retroarch/adapter';
import { expandArgs } from '../src/main/emulators/xenia/adapter';
import { CATALOG } from '../src/main/install/catalog';
import { ControllerProfileSchema } from '../src/shared/settings';
import { parseIni } from '../src/main/util/ini';

/** Minimal ISO 9660: PVD at sector 16, root directory at 20, one file at 21. */
function iso(files: { name: string; data: Buffer; dir?: boolean }[]): Buffer {
  const S = 2048;
  const img = Buffer.alloc(S * (22 + files.length));
  const pvd = img.subarray(16 * S);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'latin1');
  const rec = (buf: Buffer, off: number, name: string, lba: number, size: number, dir: boolean): number => {
    const len = 33 + name.length + ((33 + name.length) % 2);
    buf[off] = len;
    buf.writeUInt32LE(lba, off + 2);
    buf.writeUInt32LE(size, off + 10);
    buf[off + 25] = dir ? 2 : 0;
    buf[off + 32] = name.length;
    buf.write(name, off + 33, 'latin1');
    return off + len;
  };
  rec(pvd, 156, '\0', 20, S, true);
  const root = img.subarray(20 * S, 21 * S);
  let off = rec(root, 0, '\0', 20, S, true);
  off = rec(root, off, '\x01', 20, S, true);
  files.forEach((f, i) => {
    off = rec(root, off, f.dir ? f.name : `${f.name};1`, 21 + i, f.data.length, !!f.dir);
    f.data.copy(img, (21 + i) * S);
  });
  return img;
}

function sfo(entries: Record<string, string>): Buffer {
  const keys = Object.keys(entries);
  const keyTable = Buffer.from(keys.map((k) => `${k}\0`).join(''), 'utf8');
  const values = keys.map((k) => Buffer.from(`${entries[k]}\0`, 'utf8'));
  const keyStart = 20 + keys.length * 16;
  const dataStart = keyStart + keyTable.length;
  const out = Buffer.alloc(dataStart + values.reduce((n, v) => n + v.length, 0));
  out.writeUInt32BE(0x00505346, 0);
  out.writeUInt32LE(keyStart, 8);
  out.writeUInt32LE(dataStart, 12);
  out.writeUInt32LE(keys.length, 16);
  let k = 0;
  let d = 0;
  keys.forEach((key, i) => {
    const e = 20 + i * 16;
    out.writeUInt16LE(k, e);
    out.writeUInt16LE(0x0204, e + 2);
    out.writeUInt32LE(values[i]!.length, e + 4);
    out.writeUInt32LE(values[i]!.length, e + 8);
    out.writeUInt32LE(d, e + 12);
    values[i]!.copy(out, dataStart + d);
    k += key.length + 1;
    d += values[i]!.length;
  });
  keyTable.copy(out, keyStart);
  return out;
}

describe('PlayStation detection', () => {
  it('reads the serial from SYSTEM.CNF', () => {
    expect(serialFromSystemCnf('BOOT2 = cdrom0:\\SLUS_203.12;1\nVER = 1.00')).toEqual({ serial: 'SLUS-20312', ps2: true });
    expect(serialFromSystemCnf('BOOT = cdrom:\\SCUS_944.55;1')).toEqual({ serial: 'SCUS-94455', ps2: false });
  });

  it('tells PS2 and PS1 ISOs apart', async () => {
    const ps2 = await probePlayStationDisc(bufferReader(iso([{ name: 'SYSTEM.CNF', data: Buffer.from('BOOT2 = cdrom0:\\SLUS_203.12;1\n') }])));
    expect(ps2).toMatchObject({ platform: 'ps2', gameId: 'SLUS-20312' });
    const ps1 = await probePlayStationDisc(bufferReader(iso([{ name: 'SYSTEM.CNF', data: Buffer.from('BOOT = cdrom:\\SCUS_944.55;1\n') }])));
    expect(ps1).toMatchObject({ platform: 'ps1', gameId: 'SCUS-94455' });
    expect(await probePlayStationDisc(bufferReader(Buffer.alloc(40000)))).toBeNull();
  });

  it('recognises a PS3 disc', async () => {
    const r = await probePlayStationDisc(bufferReader(iso([{ name: 'PS3_DISC.SFB', data: Buffer.from('.SFB') }])));
    expect(r).toMatchObject({ platform: 'ps3' });
  });

  it('parses PARAM.SFO and reads PS3 game folders', async () => {
    expect(parseSfo(sfo({ TITLE: 'Demon’s Souls', TITLE_ID: 'BLUS30443', CATEGORY: 'DG' }))).toMatchObject({ TITLE: 'Demon’s Souls', TITLE_ID: 'BLUS30443' });
    const root = await mkdtemp(join(tmpdir(), 'arcadia-ps3-'));
    const game = join(root, 'Demons Souls', 'PS3_GAME');
    await mkdir(join(game, 'USRDIR'), { recursive: true });
    await writeFile(join(game, 'PARAM.SFO'), sfo({ TITLE: 'Demon’s Souls', TITLE_ID: 'BLUS30443', CATEGORY: 'DG' }));
    await writeFile(join(game, 'USRDIR', 'EBOOT.BIN'), 'x');
    expect(await probePs3Folder(join(game, 'USRDIR', 'EBOOT.BIN'))).toMatchObject({ platform: 'ps3', gameId: 'BLUS30443', title: 'Demon’s Souls' });
    await writeFile(join(game, 'PARAM.SFO'), sfo({ TITLE: 'Patch', TITLE_ID: 'BLUS30443', CATEGORY: 'GD' }));
    expect(await probePs3Folder(join(game, 'USRDIR', 'EBOOT.BIN'))).toBeNull();
    expect(isCandidate('EBOOT.BIN')).toBe(true);
  });

  it('identifies CHD (DVD → PS2, CD → PS1) and CSO', async () => {
    const chd = (tag: string): Buffer => {
      const b = Buffer.alloc(200);
      b.write('MComprHD', 0, 'latin1');
      b.writeUInt32BE(5, 12);
      b.writeBigUInt64BE(124n, 48);
      b.write(tag, 124, 'latin1');
      return b;
    };
    expect(await probeChd(bufferReader(chd('DVD ')))).toMatchObject({ platform: 'ps2' });
    expect(await probeChd(bufferReader(chd('CHT2')))).toMatchObject({ platform: 'ps1' });
    expect(await probeCso(bufferReader(Buffer.from('CISO....')))).toMatchObject({ platform: 'ps2' });
  });
});

describe('retro ROMs', () => {
  it('maps extensions and checks magic where there is one', async () => {
    const nes = Buffer.alloc(2048);
    nes.write('NES\x1a', 0, 'latin1');
    expect(await probeRom(bufferReader(nes), 'Zelda.nes')).toMatchObject({ platform: 'nes' });
    expect(await probeRom(bufferReader(Buffer.alloc(2048)), 'fake.nes')).toBeNull();
    const md = Buffer.alloc(2048);
    md.write('SEGA MEGA DRIVE', 0x100, 'latin1');
    expect(await probeRom(bufferReader(md), 'Sonic.md')).toMatchObject({ platform: 'genesis' });
    expect(await probeRom(bufferReader(Buffer.from('# Readme\n'.repeat(200))), 'README.md')).toBeNull();
    expect(isCandidate('Mario.z64')).toBe(true);
  });

  it('finds an installed RetroArch core', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arcadia-cores-'));
    expect(findCore('snes', dir)).toBeNull();
    await writeFile(join(dir, 'snes9x_libretro.dylib'), '');
    expect(findCore('snes', dir)).toBe(join(dir, 'snes9x_libretro.dylib'));
  });
});

describe('free box art matching', () => {
  const files = ['Legend of Zelda, The - Twilight Princess (USA).png', 'Legend of Zelda, The - Twilight Princess (Europe).png', 'Super Smash Bros. Brawl (USA).png', 'Halo 3 (USA).png', 'Halo 3 - ODST (USA).png'];
  it('normalises titles', () => {
    expect(normalizeTitle('Legend of Zelda, The - Twilight Princess (USA)')).toBe('legend of zelda twilight princess');
  });
  it('prefers exact title, then USA', () => {
    expect(bestLibretroMatch('The Legend of Zelda: Twilight Princess', files)).toBe('Legend of Zelda, The - Twilight Princess (USA).png');
    expect(bestLibretroMatch('Halo 3', files)).toBe('Halo 3 (USA).png');
    expect(bestLibretroMatch('Mario Kart Wii', files)).toBeNull();
  });
});

describe('PCSX2 handoff', () => {
  const p = ControllerProfileSchema.parse({});
  it('binds a DualShock 2 to SDL by position', () => {
    const pad = pcsx2Pad(p, 1);
    expect(pad.Cross).toBe('SDL-1/FaceSouth');
    expect(pad.L2).toBe('SDL-1/+LeftTrigger');
    expect(pad.LUp).toBe('SDL-1/-LeftY');
  });
  it('keeps the user’s settings and caps at two players', () => {
    const ini = patchPcsx2Ini(parseIni('[Filenames]\nBIOS = scph39001.bin\n[EmuCore]\nEnableCheats = true\n'), p, 4);
    expect(pcsx2Bios(ini)).toBe('scph39001.bin');
    expect(ini.get('EmuCore')!.get('EnableCheats')).toBe('true');
    expect(ini.has('Pad2')).toBe(true);
    expect(ini.has('Pad3')).toBe(false);
  });
});

describe('emulator detection and custom apps', () => {
  it('recognises Xenia Edge and versioned PCSX2 app names', () => {
    expect(CATALOG.xenia.appName.test('Xenia-edge.app')).toBe(true);
    expect(CATALOG.pcsx2.appName.test('PCSX2-v2.4.0.app')).toBe(true);
    expect(CATALOG.retroarch.appName.test('RetroArch.app')).toBe(true);
  });
  it('expands a custom launch template', () => {
    expect(expandArgs('--fullscreen {game}', '/g/My Game.nsp')).toEqual(['--fullscreen', '/g/My Game.nsp']);
    expect(expandArgs('', '/g/a.nsp')).toEqual(['/g/a.nsp']);
  });
});

describe('Gatekeeper', () => {
  it('treats an app you already approved as safe to launch', async () => {
    const { quarantineApproved } = await import('../src/main/platform/macos/bundle');
    expect(quarantineApproved('01c1;6acd977a;Chrome;0B64FFCE-4A29-4C22-A1C1-789A5361992B\n')).toBe(true);
    expect(quarantineApproved('0083;6acd977a;Chrome;')).toBe(false);
    expect(quarantineApproved('')).toBe(false);
  });
});

describe('Mac games', () => {
  const plist = (keys: Record<string, string>): string =>
    `<?xml version="1.0"?><plist><dict>${Object.entries(keys).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join('')}</dict></plist>`;
  const makeApp = async (dir: string, name: string, keys: Record<string, string>): Promise<string> => {
    const app = join(dir, name);
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(join(app, 'Contents', 'Info.plist'), plist(keys));
    return app;
  };

  it('lists game apps with their real name and skips helpers and emulators', async () => {
    const { probeMacApp } = await import('../src/main/library/probes/macapp');
    const dir = await mkdtemp(join(tmpdir(), 'arcadia-mac-'));
    const game = await makeApp(dir, 'BG3.app', { CFBundleDisplayName: "Baldur's Gate 3", CFBundleIdentifier: 'com.larian.bg3', LSApplicationCategoryType: 'public.app-category.role-playing-games' });
    expect(await probeMacApp(game)).toMatchObject({ platform: 'mac', title: "Baldur's Gate 3", gameId: 'com.larian.bg3' });
    const helper = await makeApp(dir, 'Uninstall.app', { CFBundleName: 'Uninstall', LSApplicationCategoryType: 'public.app-category.utilities' });
    expect(await probeMacApp(helper)).toBeNull();
    expect(await probeMacApp(helper, true)).toMatchObject({ platform: 'mac' });
    const emu = await makeApp(dir, 'Dolphin.app', { CFBundleName: 'Dolphin' });
    expect(await probeMacApp(emu)).toBeNull();
  });
});

describe('RPCS3 controllers', () => {
  it('writes one SDL pad per controller, numbered per name from 1', async () => {
    const { rpcs3Devices, rpcs3InputYaml } = await import('../src/main/emulators/rpcs3/config');
    const p = ControllerProfileSchema.parse({});
    const devices = rpcs3Devices(p, [{ name: 'DualSense Wireless Controller' }, { name: 'Xbox Wireless Controller' }, { name: 'DualSense Wireless Controller' }]);
    expect(devices).toEqual(['DualSense Wireless Controller 1', 'Xbox Wireless Controller 1', 'DualSense Wireless Controller 2']);
    const yaml = rpcs3InputYaml(p, devices);
    expect(yaml).toContain('Player 1 Input:\n  Handler: SDL\n  Device: "DualSense Wireless Controller 1"');
    expect(yaml).toContain('    Cross: "South"');
    expect(yaml).toContain('    L2: "LT"');
    expect(yaml).toContain('Player 4 Input:\n  Handler: "Null"');
    expect(rpcs3Devices({ ...p, multiplayer: false }, [{ name: 'DualSense Wireless Controller' }, { name: 'Xbox Wireless Controller' }])).toHaveLength(1);
  });
});

describe('Steam import', () => {
  it('finds installed Mac games and their app, skipping tools', async () => {
    const { findSteamGames } = await import('../src/main/library/steam');
    const home = await mkdtemp(join(tmpdir(), 'arcadia-steam-'));
    const steamapps = join(home, 'Library', 'Application Support', 'Steam', 'steamapps');
    await mkdir(join(steamapps, 'common', 'Hades', 'Hades.app', 'Contents'), { recursive: true });
    await mkdir(join(steamapps, 'common', 'Hades', 'Uninstall.app'), { recursive: true });
    await mkdir(join(steamapps, 'common', 'Steamworks Shared'), { recursive: true });
    const acf = (id: string, name: string, dir: string, flags = '4'): string => `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${dir}"\n}\n`;
    await writeFile(join(steamapps, 'appmanifest_1145360.acf'), acf('1145360', 'Hades', 'Hades'));
    await writeFile(join(steamapps, 'appmanifest_228980.acf'), acf('228980', 'Steamworks Common Redistributables', 'Steamworks Shared'));
    const games = await findSteamGames(home);
    expect(games).toEqual([{ appId: '1145360', name: 'Hades', installDir: join(steamapps, 'common', 'Hades'), appPath: join(steamapps, 'common', 'Hades', 'Hades.app') }]);
  });
});

describe('save backups', () => {
  it('copies new and changed saves and never deletes from the backup', async () => {
    const { backupSaves } = await import('../src/main/saves/backup');
    const { rm, readFile: read } = await import('node:fs/promises');
    const root = await mkdtemp(join(tmpdir(), 'arcadia-saves-'));
    const src = join(root, 'memcards');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'Mcd001.ps2'), 'slot one');
    const dest = join(root, 'backup');
    const sources = [{ emulator: 'pcsx2' as const, label: 'PCSX2/Memory cards', dir: src }, { emulator: 'pcsx2' as const, label: 'PCSX2/Missing', dir: join(root, 'nope') }];
    expect(await backupSaves(sources, dest)).toMatchObject({ copied: 1, errors: [] });
    expect(await backupSaves(sources, dest)).toMatchObject({ copied: 0 });
    await rm(join(src, 'Mcd001.ps2'));
    await backupSaves(sources, dest);
    expect(await read(join(dest, 'PCSX2', 'Memory cards', 'Mcd001.ps2'), 'utf8')).toBe('slot one');
  });
});

describe('PS1 multi-disc', () => {
  it('groups discs by name and keeps disc order', async () => {
    const { groupDiscs } = await import('../src/main/library/discs');
    const g = (file: string, disc: number, id: string) => ({ id: file, path: `/g/${file}`, platform: 'ps1', gameId: id, discNumber: disc, displayTitle: 'Final Fantasy VII' }) as unknown as import('../src/shared/types').Game;
    const out = groupDiscs([g('Final Fantasy VII (USA) (Disc 2).chd', 2, 'SCUS-94164'), g('Final Fantasy VII (USA) (Disc 1).chd', 1, 'SCUS-94163'), g('Crash Bandicoot (USA).chd', 1, 'SCUS-94900')]);
    const ff7 = out.find((x) => x.path.includes('Final'))!;
    expect(out).toHaveLength(2);
    expect(ff7.discPaths).toEqual(['/g/Final Fantasy VII (USA) (Disc 1).chd', '/g/Final Fantasy VII (USA) (Disc 2).chd']);
  });
});

describe('Switch and Xbox multiplayer', () => {
  const ds = { name: 'DualSense Wireless Controller' };
  const xb = { name: 'Xbox Wireless Controller' };
  const guid = '00000005-054c-0000-e60c-000000016800';

  it('adds a second DualSense to Ryubing as player 2 with the same mapping', async () => {
    const { addRyubingPlayers } = await import('../src/main/emulators/ryubing/config');
    const config = { input_config: [{ backend: 'GamepadSDL2', id: `0-${guid}`, name: 'DualSense Wireless Controller', player_index: 'Player1', controller_type: 'ProController', left_joycon: { button_l: 'LeftShoulder' } }] };
    const r = addRyubingPlayers(config, [ds, ds, xb], true);
    expect(r).toEqual({ added: 1, needsSetup: ['Xbox Wireless Controller'] });
    expect(config.input_config[1]).toMatchObject({ id: `1-${guid}`, player_index: 'Player2', controller_type: 'ProController', left_joycon: { button_l: 'LeftShoulder' } });
    expect(addRyubingPlayers(config, [ds, ds], true).added).toBe(0);
    expect(addRyubingPlayers({ input_config: [] }, [ds, ds], false).added).toBe(0);
  });

  it('clears xemu ports so connected controllers seat in order', async () => {
    const { setXemuPorts } = await import('../src/main/emulators/xemu/config');
    const multi: Record<string, any> = { input: { bindings: { port1: 'aaa', port2: 'gone', port1_driver: 'usb-xbox-gamepad' } } };
    setXemuPorts(multi, true);
    expect(multi.input.bindings).toMatchObject({ port1: '', port2: '', port3: '', port4: '', port1_driver: 'usb-xbox-gamepad' });
    expect(multi.input.auto_bind).toBe(true);
    const single: Record<string, any> = { input: { bindings: { port1: 'aaa', port2: 'bbb' } } };
    setXemuPorts(single, false);
    expect(single.input.bindings).toMatchObject({ port1: 'aaa', port2: '' });
    expect(single.input.auto_bind).toBe(false);
  });
});
