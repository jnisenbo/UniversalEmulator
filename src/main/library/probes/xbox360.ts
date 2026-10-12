import type { GameIdentity } from '@shared/types';
import type { Reader } from './io';

/**
 * Xbox 360 formats:
 *  - Disc ISO: XDVDFS "game partition" at one of several offsets depending on
 *    the disc generation. Volume descriptor at partition + 0x10000.
 *  - XEX2: the executable; the execution-info optional header carries the title ID.
 *  - STFS (CON/LIVE/PIRS): XBLA/DLC containers; title ID and name in the header.
 */

const SECTOR = 2048;
const XDVDFS_MAGIC = 'MICROSOFT*XBOX*MEDIA';
/** Plain XISO, XGD3, XGD2, XGD1 (Redump layouts). */
const PARTITION_OFFSETS = [0, 0x2080000, 0xfd90000, 0x18300000];

async function findPartition(r: Reader): Promise<{ base: number; rootSector: number; rootSize: number } | null> {
  for (const base of PARTITION_OFFSETS) {
    if (base + 0x10000 + 28 > r.size) continue;
    const vd = await r.read(base + 0x10000, 28);
    if (vd.toString('latin1', 0, 20) === XDVDFS_MAGIC) {
      return { base, rootSector: vd.readUInt32LE(20), rootSize: vd.readUInt32LE(24) };
    }
  }
  return null;
}

/**
 * XDVDFS directory: a binary tree of entries. Each entry:
 *   u16 left (in dwords), u16 right (in dwords), u32 sector, u32 size,
 *   u8 attributes, u8 nameLength, name
 * 0xFFFF padding marks the end of a sector's entries.
 */
export function findInDirectory(dir: Buffer, wanted: string): { sector: number; size: number } | null {
  const target = wanted.toLowerCase();
  const seen = new Set<number>();
  const stack = [0];
  while (stack.length) {
    const off = stack.pop()!;
    if (seen.has(off) || off + 14 > dir.length) continue;
    seen.add(off);
    const left = dir.readUInt16LE(off);
    if (left === 0xffff) continue;
    const right = dir.readUInt16LE(off + 2);
    const nameLen = dir.readUInt8(off + 13);
    const name = dir.toString('latin1', off + 14, off + 14 + nameLen).toLowerCase();
    if (name === target) return { sector: dir.readUInt32LE(off + 4), size: dir.readUInt32LE(off + 8) };
    if (left) stack.push(left * 4);
    if (right) stack.push(right * 4);
  }
  return null;
}

const EXEC_INFO_KEY = 0x00040006;

/** XEX2: magic, flags, pe offset, reserved, security offset, header count, then {key, value} pairs. */
export function parseXexTitleId(head: Buffer): { titleId: string; discNumber: number } | null {
  if (head.length < 0x18 || head.toString('latin1', 0, 4) !== 'XEX2') return null;
  const count = head.readUInt32BE(0x14);
  for (let i = 0; i < Math.min(count, 64); i++) {
    const at = 0x18 + i * 8;
    if (at + 8 > head.length) break;
    if (head.readUInt32BE(at) !== EXEC_INFO_KEY) continue;
    const info = head.readUInt32BE(at + 4);
    // media_id, version, base_version, title_id, platform, exe_type, disc_number, disc_count
    if (info + 0x18 > head.length) return null;
    return {
      titleId: head.readUInt32BE(info + 0x0c).toString(16).toUpperCase().padStart(8, '0'),
      discNumber: Math.max(0, head.readUInt8(info + 0x12) - 1),
    };
  }
  return null;
}

const XEX_HEAD_BYTES = 0x1000;

/**
 * Original Xbox XBE: "XBEH" magic, u32 base address at 0x104, u32 certificate
 * address (virtual) at 0x118. Certificate: u32 size, u32 time, u32 title ID,
 * then the title name as 40 UTF-16LE characters.
 */
export function parseXbeCertificate(head: Buffer): { titleId: string; title: string | null } | null {
  if (head.length < 0x120 || head.toString('latin1', 0, 4) !== 'XBEH') return null;
  const base = head.readUInt32LE(0x104);
  const cert = head.readUInt32LE(0x118) - base;
  if (cert < 0 || cert + 0x5c > head.length) return null;
  const titleId = head.readUInt32LE(cert + 8).toString(16).toUpperCase().padStart(8, '0');
  const raw = head.toString('utf16le', cert + 0x0c, cert + 0x0c + 80);
  const end = raw.indexOf('\0');
  const title = (end === -1 ? raw : raw.slice(0, end)).trim();
  return { titleId, title: title || null };
}

export async function probeXboxIso(r: Reader): Promise<GameIdentity | null> {
  const part = await findPartition(r);
  if (!part) return null;
  const unidentified: GameIdentity = { platform: 'xbox360', format: 'xiso', gameId: null, title: null, discNumber: 0, identified: false };
  const dir = await r.read(part.base + part.rootSector * SECTOR, Math.min(part.rootSize, 1 << 20));
  const xex = findInDirectory(dir, 'default.xex');
  if (!xex) {
    const xbe = findInDirectory(dir, 'default.xbe');
    if (!xbe) return unidentified;
    const parsed = parseXbeCertificate(await r.read(part.base + xbe.sector * SECTOR, XEX_HEAD_BYTES));
    return {
      platform: 'xbox',
      format: 'xiso',
      gameId: parsed?.titleId ?? null,
      title: parsed?.title ?? null,
      discNumber: 0,
      identified: !!parsed,
      // xemu boots XISO images; full Redump dumps need converting first.
      ...(part.base !== 0 ? { note: 'This is a full disc dump. xemu needs an XISO: convert it with extract-xiso -r first.' } : {}),
    };
  }
  const parsed = parseXexTitleId(await r.read(part.base + xex.sector * SECTOR, XEX_HEAD_BYTES));
  if (!parsed) return unidentified;
  return { ...unidentified, gameId: parsed.titleId, discNumber: parsed.discNumber, identified: true };
}

export async function probeXex(r: Reader): Promise<GameIdentity | null> {
  const parsed = parseXexTitleId(await r.read(0, XEX_HEAD_BYTES));
  if (!parsed) return null;
  return { platform: 'xbox360', format: 'xex', gameId: parsed.titleId, title: null, discNumber: parsed.discNumber, identified: true };
}

/** STFS header: magic at 0, content type u32 at 0x344, title ID u32 at 0x360, UTF-16BE display name at 0x411. */
const STFS_GAME_TYPES = new Set([0x000d0000 /* XBLA */, 0x00007000 /* Games on Demand */, 0x00080000 /* Game demo */]);
export async function probeStfs(r: Reader): Promise<GameIdentity | null> {
  const head = await r.read(0, 0x500);
  if (head.length < 0x491) return null;
  const magic = head.toString('latin1', 0, 4);
  if (magic !== 'CON ' && magic !== 'LIVE' && magic !== 'PIRS') return null;
  const contentType = head.readUInt32BE(0x344);
  if (!STFS_GAME_TYPES.has(contentType)) return null; // saves, DLC, themes, etc.
  const titleId = head.readUInt32BE(0x360).toString(16).toUpperCase().padStart(8, '0');
  return { platform: 'xbox360', format: 'stfs', gameId: titleId, title: utf16be(head.subarray(0x411, 0x491)) || null, discNumber: 0, identified: true };
}

function utf16be(buf: Buffer): string {
  const swapped = Buffer.from(buf);
  swapped.swap16();
  const s = swapped.toString('utf16le');
  const end = s.indexOf('\0');
  return (end === -1 ? s : s.slice(0, end)).trim();
}
