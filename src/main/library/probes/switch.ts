import { createDecipheriv } from 'node:crypto';
import type { GameIdentity } from '@shared/types';
import type { Reader } from './io';

/**
 * Switch dumps. Title ID sources, most to least reliable:
 *   1. NCA header (AES-128-XTS with the user's header_key) → program ID
 *   2. Ticket filename in the PFS0 (<rightsId>.tik, rightsId = titleId + keygen)
 *   3. A [0100XXXXXXXXXXXX] tag in the filename
 */

interface Entry {
  name: string;
  offset: number; // absolute file offset
  size: number;
}

const TITLE_ID_RE = /\[(01[0-9A-Fa-f]{14})\]/;

export function titleIdFromFileName(fileName: string): string | null {
  return TITLE_ID_RE.exec(fileName)?.[1]?.toUpperCase() ?? null;
}

export function contentKind(titleId: string): 'base' | 'update' | 'dlc' {
  const low = parseInt(titleId.slice(-4), 16);
  if ((low & 0xfff) === 0x800) return 'update';
  if ((low & 0xfff) === 0) return 'base';
  return 'dlc';
}

/**
 * PFS0 (NSP) / HFS0 (XCI partitions):
 *   magic(4) | u32 fileCount | u32 stringTableSize | u32 reserved
 *   entries: PFS0 0x18 bytes {u64 offset, u64 size, u32 nameOffset, u32 pad}
 *            HFS0 0x40 bytes {u64 offset, u64 size, u32 nameOffset, u32 hashedSize, u64 pad, 32-byte hash}
 *   string table, then data. Entry offsets are relative to the data start.
 */
async function readPartition(r: Reader, base: number, magic: 'PFS0' | 'HFS0'): Promise<Entry[] | null> {
  const head = await r.read(base, 16);
  if (head.length < 16 || head.toString('latin1', 0, 4) !== magic) return null;
  const count = head.readUInt32LE(4);
  const strSize = head.readUInt32LE(8);
  const entrySize = magic === 'PFS0' ? 0x18 : 0x40;
  if (count === 0 || count > 4096 || strSize > 1 << 20) return null;

  const table = await r.read(base + 16, count * entrySize + strSize);
  if (table.length < count * entrySize + strSize) return null;
  const strings = table.subarray(count * entrySize);
  const dataStart = base + 16 + count * entrySize + strSize;

  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const e = table.subarray(i * entrySize);
    const nameOff = e.readUInt32LE(16);
    const nameEnd = strings.indexOf(0, nameOff);
    entries.push({
      name: strings.toString('utf8', nameOff, nameEnd === -1 ? undefined : nameEnd),
      offset: dataStart + Number(e.readBigUInt64LE(0)),
      size: Number(e.readBigUInt64LE(8)),
    });
  }
  return entries;
}

/** Nintendo's XTS uses a big-endian sector number as the tweak. */
function xtsTweak(sector: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sector), 8);
  return iv;
}

export function decryptNcaHeader(encrypted: Buffer, headerKey: Buffer): Buffer {
  const out: Buffer[] = [];
  for (let s = 0; s * 0x200 < encrypted.length; s++) {
    const d = createDecipheriv('aes-128-xts', headerKey, xtsTweak(s));
    d.setAutoPadding(false);
    out.push(d.update(encrypted.subarray(s * 0x200, (s + 1) * 0x200)), d.final());
  }
  return Buffer.concat(out);
}

/** Decrypted NCA header: magic "NCA3"/"NCA2" at 0x200, content type at 0x205, program ID at 0x210. */
export function parseNcaHeader(dec: Buffer): { titleId: string; contentType: number } | null {
  if (dec.length < 0x400) return null;
  const magic = dec.toString('latin1', 0x200, 0x204);
  if (magic !== 'NCA3' && magic !== 'NCA2') return null;
  const programId = dec.readBigUInt64LE(0x210);
  return { titleId: programId.toString(16).toUpperCase().padStart(16, '0'), contentType: dec.readUInt8(0x205) };
}

const NCA_PROGRAM = 0;

async function titleIdFromNcas(r: Reader, entries: Entry[], headerKey: Buffer): Promise<string | null> {
  const ncas = entries.filter((e) => e.name.endsWith('.nca') && e.size >= 0x400);
  // Prefer the Program NCA; cnmt/control share the same ID for base games.
  let fallback: string | null = null;
  for (const nca of ncas.sort((a, b) => b.size - a.size)) {
    const parsed = parseNcaHeader(decryptNcaHeader(await r.read(nca.offset, 0x400), headerKey));
    if (!parsed) continue;
    if (parsed.contentType === NCA_PROGRAM) return parsed.titleId;
    fallback ??= parsed.titleId;
  }
  return fallback;
}

function titleIdFromTicket(entries: Entry[]): string | null {
  for (const e of entries) {
    const m = /^([0-9a-fA-F]{16})[0-9a-fA-F]{16}\.tik$/.exec(e.name);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

function identity(format: 'nsp' | 'xci', titleId: string | null): GameIdentity {
  return {
    platform: 'switch',
    format,
    gameId: titleId,
    title: null, // Needs NACP from the control NCA (key area decryption): Phase 3 metadata.
    discNumber: 0,
    identified: titleId !== null,
    ...(titleId ? { contentKind: contentKind(titleId) } : {}),
  };
}

export async function probeNsp(r: Reader, fileName: string, headerKey: Buffer | null): Promise<GameIdentity | null> {
  const entries = await readPartition(r, 0, 'PFS0');
  if (!entries) return null;
  const fromNca = headerKey ? await titleIdFromNcas(r, entries, headerKey).catch(() => null) : null;
  return identity('nsp', fromNca ?? titleIdFromTicket(entries) ?? titleIdFromFileName(fileName));
}

/**
 * XCI: "HEAD" magic at 0x100; u64 root HFS0 offset at 0x130.
 * Root HFS0 holds the "secure" partition, which holds the game's NCAs.
 */
export async function probeXci(r: Reader, fileName: string, headerKey: Buffer | null): Promise<GameIdentity | null> {
  const head = await r.read(0x100, 0x40);
  if (head.length < 0x38 || head.toString('latin1', 0, 4) !== 'HEAD') return null;
  let titleId: string | null = null;
  if (headerKey) {
    const rootOffset = Number(head.readBigUInt64LE(0x30));
    const root = await readPartition(r, rootOffset, 'HFS0');
    const secure = root?.find((e) => e.name === 'secure');
    const entries = secure ? await readPartition(r, secure.offset, 'HFS0') : null;
    if (entries) titleId = await titleIdFromNcas(r, entries, headerKey).catch(() => null);
  }
  return identity('xci', titleId ?? titleIdFromFileName(fileName));
}
