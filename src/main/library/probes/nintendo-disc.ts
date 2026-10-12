import { inflateSync } from 'node:zlib';
import type { DiscFormat, GameIdentity } from '@shared/types';
import { cString, isPrintableId, type Reader } from './io';

/**
 * GameCube / Wii disc header (first 0x80 bytes are enough):
 *   0x00  6  game ID (e.g. "GALE01")
 *   0x06  1  disc number
 *   0x18  4  Wii magic 0x5D1C9EA3
 *   0x1C  4  GameCube magic 0xC2339F3D
 *   0x20 64  internal title
 */
const WII_MAGIC = 0x5d1c9ea3;
const GC_MAGIC = 0xc2339f3d;
export const DISC_HEADER_SIZE = 0x80;

export function parseDiscHeader(header: Buffer, format: DiscFormat): GameIdentity | null {
  if (header.length < 0x60) return null;
  const isWii = header.readUInt32BE(0x18) === WII_MAGIC;
  const isGc = header.readUInt32BE(0x1c) === GC_MAGIC;
  if (!isWii && !isGc) return null;
  const id = header.subarray(0, 6).toString('latin1');
  const title = cString(header.subarray(0x20, 0x60));
  return {
    platform: isWii ? 'wii' : 'gamecube',
    format,
    gameId: isPrintableId(id, 6) ? id : null,
    title: title || null,
    discNumber: header.readUInt8(6),
    identified: isPrintableId(id, 6),
  };
}

/** Plain ISO / GCM. */
export async function probeIso(r: Reader): Promise<GameIdentity | null> {
  return parseDiscHeader(await r.read(0, DISC_HEADER_SIZE), 'iso');
}

/**
 * WBFS: "WBFS" magic, then u32 sector count, u8 hd_sec_sz_s at 0x08.
 * The first disc slot's copy of the disc header starts at hd sector 1.
 */
export async function probeWbfs(r: Reader): Promise<GameIdentity | null> {
  const head = await r.read(0, 16);
  if (head.length < 16 || head.toString('latin1', 0, 4) !== 'WBFS') return null;
  const hdSectorShift = head.readUInt8(8);
  if (hdSectorShift < 9 || hdSectorShift > 16) return null;
  return parseDiscHeader(await r.read(1 << hdSectorShift, DISC_HEADER_SIZE), 'wbfs');
}

/**
 * WIA / RVZ: header 1 is 0x48 bytes; header 2 follows. Header 2 starts with
 * disc_type, compression, compression_level, chunk_size (4 × u32) then an
 * uncompressed copy of the first 0x80 bytes of the disc → file offset 0x58.
 */
export async function probeWiaRvz(r: Reader): Promise<GameIdentity | null> {
  const magic = await r.read(0, 4);
  const tag = magic.toString('latin1', 0, 3);
  if (magic.length < 4 || magic[3] !== 0x01 || (tag !== 'RVZ' && tag !== 'WIA')) return null;
  return parseDiscHeader(await r.read(0x58, DISC_HEADER_SIZE), tag === 'RVZ' ? 'rvz' : 'wia');
}

/**
 * GCZ (Dolphin compressed): 32-byte header
 *   u32 magic 0xB10BC001 | u32 sub_type | u64 compressed_size | u64 data_size
 *   u32 block_size | u32 num_blocks
 * then u64 block_pointers[num_blocks], u32 hashes[num_blocks], then data.
 * Pointer top bit set → block stored uncompressed. Otherwise zlib.
 */
const GCZ_MAGIC = 0xb10bc001;
export async function probeGcz(r: Reader): Promise<GameIdentity | null> {
  const head = await r.read(0, 32);
  if (head.length < 32 || head.readUInt32LE(0) !== GCZ_MAGIC) return null;
  const blockSize = head.readUInt32LE(24);
  const numBlocks = head.readUInt32LE(28);
  if (numBlocks === 0 || blockSize === 0 || blockSize > 1 << 24) return null;

  const pointers = await r.read(32, 16);
  if (pointers.length < 8) return null;
  const first = pointers.readBigUInt64LE(0);
  const next = numBlocks > 1 && pointers.length >= 16 ? pointers.readBigUInt64LE(8) : null;
  const dataStart = 32 + numBlocks * 8 + numBlocks * 4;

  const UNCOMPRESSED = 1n << 63n;
  const isRaw = (first & UNCOMPRESSED) !== 0n;
  const start = Number(first & ~UNCOMPRESSED);
  const end = next !== null ? Number(next & ~UNCOMPRESSED) : start + blockSize;
  const stored = await r.read(dataStart + start, Math.min(end - start, blockSize + 1024));

  let block: Buffer;
  try {
    block = isRaw ? stored : inflateSync(stored);
  } catch {
    return { platform: 'gamecube', format: 'gcz', gameId: null, title: null, discNumber: 0, identified: false };
  }
  return parseDiscHeader(block.subarray(0, DISC_HEADER_SIZE), 'gcz');
}
