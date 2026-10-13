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
    expect(await probeRom(bufferReader(Buffer.alloc(2048)), 'Sonic.md')).toMatchObject({ platform: 'genesis' });
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
