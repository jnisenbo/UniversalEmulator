import type { EmulatorId } from '@shared/platforms';

/**
 * Where each emulator is downloaded from. Only the emulators themselves:
 * never games, keys, firmware or BIOS.
 *
 * Sources are tried in order. Homebrew's cask API gives the official download
 * URL plus a SHA-256; GitHub releases give a SHA-256 digest per asset.
 */
export type Source =
  | { kind: 'cask'; token: string }
  | { kind: 'github'; repo: string; asset: RegExp }
  /** Forgejo/Gitea release API (Ryubing hosts its builds on git.ryujinx.app). */
  | { kind: 'forgejo'; host: string; repo: string; asset: RegExp; label?: string };

export interface CatalogEntry {
  id: EmulatorId;
  sources: Source[];
  /** Download hosts allowed for this emulator (exact host or subdomain). */
  hosts: string[];
  /** Name of the .app inside the download. */
  appName: RegExp;
  homepage: string;
  /** What the user must still do in the emulator itself, with their own files. */
  firstRun?: string;
  /** No automatic install: link to the project page instead. */
  manualOnly?: boolean;
}

const GITHUB_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

export const CATALOG: Record<EmulatorId, CatalogEntry> = {
  dolphin: {
    id: 'dolphin',
    sources: [{ kind: 'cask', token: 'dolphin' }],
    hosts: ['dl.dolphin-emu.org', 'dolphin-emu.org'],
    appName: /^Dolphin\.app$/i,
    homepage: 'https://dolphin-emu.org/download/',
  },
  ryubing: {
    id: 'ryubing',
    sources: [
      { kind: 'forgejo', host: 'git.ryujinx.app', repo: 'Ryubing/Stable', asset: /macos.*\.(tar\.gz|zip|dmg)$/i },
      { kind: 'cask', token: 'ryubing' },
      { kind: 'forgejo', host: 'git.ryujinx.app', repo: 'Ryubing/Canary', asset: /macos.*\.(tar\.gz|zip|dmg)$/i, label: 'Canary' },
    ],
    hosts: [...GITHUB_HOSTS, 'git.ryujinx.app'],
    appName: /^(Ryujinx|Ryubing)\.app$/i,
    homepage: 'https://ryujinx.app/',
    firstRun: 'Open Ryubing once and install the keys and firmware dumped from your own Switch (File → Install Keys / Install Firmware).',
  },
  xemu: {
    id: 'xemu',
    sources: [
      { kind: 'cask', token: 'xemu' },
      { kind: 'github', repo: 'xemu-project/xemu', asset: /macos.*\.zip$/i },
    ],
    hosts: GITHUB_HOSTS,
    appName: /^xemu\.app$/i,
    homepage: 'https://xemu.app/docs/download/',
    firstRun: 'Open xemu once and choose the BIOS, MCPX boot ROM and hard disk image from your own Xbox (Machine → System).',
  },
  xenia: {
    id: 'xenia',
    sources: [],
    hosts: [],
    appName: /^(XeniOS|Xenia|xenia_canary)\.app$/i,
    homepage: 'https://xenios.jp/',
    manualOnly: true,
  },
};

export function hostAllowed(url: string, hosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}
