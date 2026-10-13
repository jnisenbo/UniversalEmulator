import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Platform } from '@shared/platforms';
import type { DiscFormat, GameIdentity } from '@shared/types';
import type { Reader } from './io';

/**
 * PlayStation discs are ISO 9660. The root directory tells them apart:
 *  - PS3: a PS3_GAME folder (or PS3_DISC.SFB); PARAM.SFO has the title and ID.
 *  - PS2: SYSTEM.CNF with a BOOT2 line ("BOOT2 = cdrom0:\SLUS_203.12;1").
 *  - PS1: SYSTEM.CNF with a BOOT line, or no SYSTEM.CNF but a PSX.EXE.
 * Raw CD images (.bin from a .cue) have 2352-byte sectors with the 2048 data
 * bytes at offset 24 (Mode 2) or 16 (Mode 1).
 */

export interface SectorLayout {
  size: number;
  dataOffset: number;
}
export const ISO_LAYOUT: SectorLayout = { size: 2048, dataOffset: 0 };

interface DirEntry {
  name: string;
  lba: number;
  size: number;
  isDir: boolean;
}

async function readSectors(r: Reader, layout: SectorLayout, lba: number, bytes: number): Promise<Buffer> {
  if (layout.size === 2048) return r.read(lba * 2048, bytes);
  const parts: Buffer[] = [];
  for (let got = 0, s = lba; got < bytes; s++, got += 2048) {
    parts.push(await r.read(s * layout.size + layout.dataOffset, Math.min(2048, bytes - got)));
  }
  return Buffer.concat(parts);
}

function parseDir(buf: Buffer): DirEntry[] {
  const out: DirEntry[] = [];
  let off = 0;
  while (off < buf.length) {
    const len = buf[off]!;
    if (len === 0) {
      // Records never cross a sector boundary: skip to the next sector.
      off = (Math.floor(off / 2048) + 1) * 2048;
      continue;
    }
    if (off + 33 > buf.length) break;
    const nameLen = buf[off + 32]!;
    const raw = buf.toString('latin1', off + 33, off + 33 + nameLen);
    if (raw !== '\0' && raw !== '\x01') {
      out.push({
        name: raw.replace(/;\d+$/, '').replace(/\.$/, '').toUpperCase(),
        lba: buf.readUInt32LE(off + 2),
        size: buf.readUInt32LE(off + 10),
        isDir: (buf[off + 25]! & 2) !== 0,
      });
    }
    off += len;
  }
  return out;
}

async function rootDir(r: Reader, layout: SectorLayout): Promise<{ entries: DirEntry[] } | null> {
  const pvd = await readSectors(r, layout, 16, 2048);
  if (pvd.length < 190 || pvd.toString('latin1', 1, 6) !== 'CD001') return null;
  const lba = pvd.readUInt32LE(156 + 2);
  const size = Math.min(pvd.readUInt32LE(156 + 10), 64 * 2048);
  return { entries: parseDir(await readSectors(r, layout, lba, size)) };
}

async function readEntry(r: Reader, layout: SectorLayout, e: DirEntry, max = 64 * 1024): Promise<Buffer> {
  return readSectors(r, layout, e.lba, Math.min(e.size, max));
}

/** "cdrom0:\SLUS_203.12;1" → "SLUS-20312". */
export function serialFromSystemCnf(text: string): { serial: string | null; ps2: boolean } {
  const ps2 = /^\s*BOOT2\s*=/im.test(text);
  const m = /BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4})[_-](\d{3})\.(\d{2})/i.exec(text);
  return { serial: m ? `${m[1]!.toUpperCase()}-${m[2]}${m[3]}` : null, ps2 };
}

/** PARAM.SFO: key/value table used by PS3 (and PSP/PS Vita) games. */
export function parseSfo(buf: Buffer): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (buf.length < 20 || buf.readUInt32BE(0) !== 0x00505346) return out;
  const keyStart = buf.readUInt32LE(8);
  const dataStart = buf.readUInt32LE(12);
  const count = Math.min(buf.readUInt32LE(16), 256);
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    if (e + 16 > buf.length) break;
    const keyOff = buf.readUInt16LE(e);
    const fmt = buf.readUInt16LE(e + 2);
    const len = buf.readUInt32LE(e + 4);
    const dataOff = buf.readUInt32LE(e + 12);
    const kEnd = buf.indexOf(0, keyStart + keyOff);
    const key = buf.toString('utf8', keyStart + keyOff, kEnd === -1 ? undefined : kEnd);
    const at = dataStart + dataOff;
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(at);
    else out[key] = buf.toString('utf8', at, at + len).replace(/\0+$/, '').trim();
  }
  return out;
}

const identity = (platform: Platform, format: DiscFormat, gameId: string | null, title: string | null): GameIdentity => ({
  platform,
  format,
  gameId,
  title,
  discNumber: 1,
  identified: true,
});

/** Identify a PlayStation ISO 9660 image (any generation). */
export async function probePlayStationDisc(r: Reader, layout: SectorLayout = ISO_LAYOUT, format: DiscFormat = 'iso'): Promise<GameIdentity | null> {
  const root = await rootDir(r, layout);
  if (!root) return null;
  const find = (name: string): DirEntry | undefined => root.entries.find((e) => e.name === name);

  const ps3Game = find('PS3_GAME');
  if (ps3Game || find('PS3_DISC.SFB')) {
    let title: string | null = null;
    let id: string | null = null;
    if (ps3Game?.isDir) {
      const sfoEntry = parseDir(await readEntry(r, layout, ps3Game)).find((e) => e.name === 'PARAM.SFO');
      if (sfoEntry) {
        const sfo = parseSfo(await readEntry(r, layout, sfoEntry));
        title = typeof sfo.TITLE === 'string' && sfo.TITLE ? sfo.TITLE : null;
        id = typeof sfo.TITLE_ID === 'string' && sfo.TITLE_ID ? sfo.TITLE_ID : null;
      }
    }
    return identity('ps3', format, id, title);
  }

  const cnf = find('SYSTEM.CNF');
  if (cnf) {
    const { serial, ps2 } = serialFromSystemCnf((await readEntry(r, layout, cnf, 4096)).toString('latin1'));
    return identity(ps2 ? 'ps2' : 'ps1', format, serial, null);
  }
  if (find('PSX.EXE')) return identity('ps1', format, null, null);
  return null;
}

/**
 * A .cue sheet: identify the first data track's .bin. Returns null for
 * audio-only or non-PlayStation discs (Sega CD, PC Engine CD…).
 */
export async function probeCue(cuePath: string, open: <T>(path: string, fn: (r: Reader) => Promise<T>) => Promise<T>): Promise<GameIdentity | null> {
  const text = await readFile(cuePath, 'utf8');
  const file = /FILE\s+"([^"]+)"/i.exec(text)?.[1] ?? /FILE\s+(\S+)/i.exec(text)?.[1];
  const mode = /TRACK\s+\d+\s+(MODE[12])\/(\d+)/i.exec(text);
  if (!file || !mode) return null;
  const size = Number(mode[2]);
  const layout: SectorLayout = size === 2048 ? ISO_LAYOUT : { size, dataOffset: mode[1]!.toUpperCase() === 'MODE2' ? 24 : 16 };
  return open(join(dirname(cuePath), file), (r) => probePlayStationDisc(r, layout, 'cue'));
}

/**
 * CHD (MAME compressed disc). We can't read files inside without
 * decompressing, but the metadata says CD or DVD: DVD → PS2, CD → PS1.
 */
export async function probeChd(r: Reader): Promise<GameIdentity | null> {
  const head = await r.read(0, 64);
  if (head.length < 64 || head.toString('latin1', 0, 8) !== 'MComprHD') return null;
  const version = head.readUInt32BE(12);
  const metaOffset = Number(version >= 5 ? head.readBigUInt64BE(48) : head.readBigUInt64BE(36));
  const tags = new Set<string>();
  let off = metaOffset;
  for (let i = 0; off > 0 && off < r.size && i < 64; i++) {
    const m = await r.read(off, 16);
    if (m.length < 16) break;
    tags.add(m.toString('latin1', 0, 4));
    off = Number(m.readBigUInt64BE(8));
  }
  if (tags.has('DVD ')) return identity('ps2', 'chd', null, null);
  if (tags.has('CHT2') || tags.has('CHTR') || tags.has('CHCD')) return identity('ps1', 'chd', null, null);
  return null;
}

/** CSO / ZSO compressed PS2 ISO. */
export async function probeCso(r: Reader): Promise<GameIdentity | null> {
  const magic = (await r.read(0, 4)).toString('latin1');
  return magic === 'CISO' || magic === 'ZISO' ? identity('ps2', 'cso', null, null) : null;
}

/**
 * A PS3 game folder (disc folder or one installed in RPCS3): …/USRDIR/EBOOT.BIN
 * with PARAM.SFO one level up. Only full games are listed, not patches.
 */
export async function probePs3Folder(ebootPath: string): Promise<GameIdentity | null> {
  let sfo: Record<string, string | number>;
  try {
    sfo = parseSfo(await readFile(join(dirname(dirname(ebootPath)), 'PARAM.SFO')));
  } catch {
    return null;
  }
  const category = typeof sfo.CATEGORY === 'string' ? sfo.CATEGORY : '';
  if (category && !['DG', 'HG'].includes(category)) return null;
  const title = typeof sfo.TITLE === 'string' && sfo.TITLE ? sfo.TITLE : null;
  const id = typeof sfo.TITLE_ID === 'string' && sfo.TITLE_ID ? sfo.TITLE_ID : null;
  return identity('ps3', 'folder', id, title);
}
