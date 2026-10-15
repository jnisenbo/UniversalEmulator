import { basename, extname } from 'node:path';
import type { GameIdentity } from '@shared/types';
import { withReader, type Reader } from './io';
import { probeGcz, probeIso, probeWbfs, probeWiaRvz } from './nintendo-disc';
import { probeNsp, probeXci } from './switch';
import { probeStfs, probeXboxIso, probeXex } from './xbox360';
import { probeChd, probeCso, probeCue, probePlayStationDisc, probePs3Folder } from './playstation';
import { probeRom, ROM_EXTENSIONS } from './retro';
import { probeMacApp } from './macapp';

export interface ProbeContext {
  /** Switch header_key from the user's prod.keys, if configured. */
  switchHeaderKey: Buffer | null;
  /** Mac game apps you added one by one: always listed. */
  explicitApps?: Set<string>;
  /** Installed Steam games with a Mac app, keyed by the app's path. */
  steamGames?: Map<string, import('../steam').SteamGame>;
}

export const CANDIDATE_EXTENSIONS = new Set([
  '.iso', '.gcm', '.rvz', '.wia', '.wbfs', '.gcz', '.nsp', '.xci', '.xex',
  '.cue', '.chd', '.cso', '.zso',
  ...Object.keys(ROM_EXTENSIONS),
]);

/** XBLA STFS packages usually have no extension; PS3 game folders are found by their EBOOT.BIN. */
export function isCandidate(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  return CANDIDATE_EXTENSIONS.has(ext) || /^eboot\.bin$/i.test(fileName) || (ext === '' && !fileName.startsWith('.'));
}

export async function probeReader(r: Reader, fileName: string, ctx: ProbeContext): Promise<GameIdentity | null> {
  switch (extname(fileName).toLowerCase()) {
    case '.iso':
    case '.gcm':
      // .iso is ambiguous: try Nintendo first (cheap: one 0x80 read), then Xbox, then PlayStation.
      return (await probeIso(r)) ?? (await probeXboxIso(r)) ?? (await probePlayStationDisc(r));
    case '.chd':
      return probeChd(r);
    case '.cso':
    case '.zso':
      return probeCso(r);
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
      return probeRom(r, fileName);
  }
}

export function probeFile(path: string, ctx: ProbeContext): Promise<GameIdentity | null> {
  const name = basename(path);
  const steam = ctx.steamGames?.get(path);
  if (steam) {
    return Promise.resolve({
      platform: 'mac',
      format: 'app',
      gameId: `steam-${steam.appId}`,
      title: steam.name,
      discNumber: 1,
      identified: true,
      steamAppId: steam.appId,
      steamInstallDir: steam.installDir,
    });
  }
  if (/\.app$/i.test(name)) return probeMacApp(path, ctx.explicitApps?.has(path) ?? false);
  if (/^eboot\.bin$/i.test(name)) return /[\\/]USRDIR[\\/]EBOOT\.BIN$/i.test(path) ? probePs3Folder(path) : Promise.resolve(null);
  if (/\.cue$/i.test(name)) {
    return probeCue(path, withReader).then((id) => {
      const disc = /\(Disc (\d+)/i.exec(name);
      return id && disc ? { ...id, discNumber: Number(disc[1]) } : id;
    });
  }
  return withReader(path, (r) => probeReader(r, name, ctx)).then((id) => {
    // PS1 multi-disc sets are separate files named "(Disc 1)", "(Disc 2)"…
    const disc = /\(Disc (\d+)/i.exec(name);
    return id && disc && (id.platform === 'ps1' || id.platform === 'ps2') ? { ...id, discNumber: Number(disc[1]) } : id;
  });
}
