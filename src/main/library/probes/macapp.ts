import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GameIdentity } from '@shared/types';
import { CATALOG } from '../../install/catalog';
import { run } from '../../util/exec';

export interface AppInfo {
  name: string | null;
  bundleId: string | null;
  iconFile: string | null;
  category: string | null;
}

const KEYS = ['CFBundleDisplayName', 'CFBundleName', 'CFBundleIdentifier', 'CFBundleIconFile', 'LSApplicationCategoryType'] as const;

/** A few string keys from an app's Info.plist (plutil on macOS, XML fallback elsewhere). */
export async function readAppInfo(appPath: string): Promise<AppInfo> {
  const plist = join(appPath, 'Contents', 'Info.plist');
  const values: Partial<Record<(typeof KEYS)[number], string>> = {};
  if (process.platform === 'darwin') {
    const results = await Promise.all(KEYS.map((k) => run('/usr/bin/plutil', ['-extract', k, 'raw', '-o', '-', plist])));
    results.forEach((r, i) => {
      if (r.code === 0 && r.stdout.trim()) values[KEYS[i]!] = r.stdout.trim();
    });
  } else {
    const xml = await readFile(plist, 'utf8').catch(() => '');
    for (const k of KEYS) {
      const m = new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(xml);
      if (m?.[1]) values[k] = m[1].trim();
    }
  }
  return {
    name: values.CFBundleDisplayName || values.CFBundleName || null,
    bundleId: values.CFBundleIdentifier ?? null,
    iconFile: values.CFBundleIconFile ?? null,
    category: values.LSApplicationCategoryType ?? null,
  };
}

/** Emulators and Arcadia itself live next to games sometimes; they aren't games. */
function isEmulatorApp(fileName: string, bundleId: string | null): boolean {
  if (/^arcadia\.app$/i.test(fileName) || bundleId?.startsWith('com.jnisenbo.arcadia')) return true;
  return Object.values(CATALOG).some((c) => c.appName.test(fileName));
}

/** A Mac game app. `explicit` = added by you, so it's listed whatever it is. */
export async function probeMacApp(appPath: string, explicit = false): Promise<GameIdentity | null> {
  const fileName = basename(appPath);
  let info: AppInfo;
  try {
    info = await readAppInfo(appPath);
  } catch {
    return null;
  }
  if (!explicit && isEmulatorApp(fileName, info.bundleId)) return null;
  // Inside a game folder there can be helper apps (uninstallers, crash reporters):
  // skip apps that declare a category other than games.
  if (!explicit && info.category && !/games/i.test(info.category)) return null;
  return {
    platform: 'mac',
    format: 'app',
    gameId: info.bundleId,
    title: info.name ?? fileName.replace(/\.app$/i, ''),
    discNumber: 1,
    identified: true,
  };
}
