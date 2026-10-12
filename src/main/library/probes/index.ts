import { basename, extname } from 'node:path';
import type { GameIdentity } from '@shared/types';
import { withReader, type Reader } from './io';
import { probeGcz, probeIso, probeWbfs, probeWiaRvz } from './nintendo-disc';
import { probeNsp, probeXci } from './switch';
import { probeStfs, probeXboxIso, probeXex } from './xbox360';

export interface ProbeContext {
  /** Switch header_key from the user's prod.keys, if configured. */
  switchHeaderKey: Buffer | null;
}

export const CANDIDATE_EXTENSIONS = new Set(['.iso', '.gcm', '.rvz', '.wia', '.wbfs', '.gcz', '.nsp', '.xci', '.xex']);

/** XBLA STFS packages usually have no extension. */
export function isCandidate(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  return CANDIDATE_EXTENSIONS.has(ext) || (ext === '' && !fileName.startsWith('.'));
}

export async function probeReader(r: Reader, fileName: string, ctx: ProbeContext): Promise<GameIdentity | null> {
  switch (extname(fileName).toLowerCase()) {
    case '.iso':
    case '.gcm':
      // .iso is ambiguous: try Nintendo first (cheap: one 0x80 read), then Xbox.
      return (await probeIso(r)) ?? (await probeXboxIso(r));
    case '.rvz':
    case '.wia':
      return probeWiaRvz(r);
    case '.wbfs':
      return probeWbfs(r);
    case '.gcz':
      return probeGcz(r);
    case '.nsp':
      return probeNsp(r, fileName, ctx.switchHeaderKey);
    case '.xci':
      return probeXci(r, fileName, ctx.switchHeaderKey);
    case '.xex':
      return probeXex(r);
    case '':
      return probeStfs(r);
    default:
      return null;
  }
}

export function probeFile(path: string, ctx: ProbeContext): Promise<GameIdentity | null> {
  return withReader(path, (r) => probeReader(r, basename(path), ctx));
}
