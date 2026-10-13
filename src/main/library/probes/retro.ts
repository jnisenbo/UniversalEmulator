import { extname } from 'node:path';
import type { Platform } from '@shared/platforms';
import type { GameIdentity } from '@shared/types';
import type { Reader } from './io';

/** Cartridge ROMs are identified by extension (with a magic check where one exists). */
export const ROM_EXTENSIONS: Record<string, Platform> = {
  '.nes': 'nes',
  '.sfc': 'snes',
  '.smc': 'snes',
  '.z64': 'n64',
  '.n64': 'n64',
  '.v64': 'n64',
  '.gb': 'gb',
  '.gbc': 'gb',
  '.gba': 'gba',
  '.md': 'genesis',
  '.gen': 'genesis',
  '.smd': 'genesis',
};

const N64_MAGIC = new Set(['80371240', '37804012', '40123780']);

export async function probeRom(r: Reader, fileName: string): Promise<GameIdentity | null> {
  const platform = ROM_EXTENSIONS[extname(fileName).toLowerCase()];
  if (!platform) return null;
  if (platform === 'nes' && (await r.read(0, 4)).toString('latin1') !== 'NES\x1a') return null;
  if (platform === 'n64' && !N64_MAGIC.has((await r.read(0, 4)).toString('hex'))) return null;
  if (r.size < 1024) return null;
  return { platform, format: 'rom', gameId: null, title: null, discNumber: 1, identified: true };
}
