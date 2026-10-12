import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Issue } from '@shared/types';
import { run } from '../../util/exec';

export interface ResolvedApp {
  /** What the user selected: an .app bundle or a bare executable. */
  installPath: string;
  executable: string;
  version: string | null;
  bundleId: string | null;
  arch: string[];
}

const isMac = process.platform === 'darwin';

/**
 * Resolve the real executable inside an .app bundle via Info.plist →
 * CFBundleExecutable. plutil handles both XML and binary plists.
 * A non-bundle path is treated as the executable itself (useful in dev on Linux).
 */
export async function resolveApp(installPath: string): Promise<ResolvedApp> {
  const info = await stat(installPath);
  if (!installPath.endsWith('.app') || !info.isDirectory()) {
    return { installPath, executable: installPath, version: null, bundleId: null, arch: await archOf(installPath) };
  }
  const plistPath = join(installPath, 'Contents', 'Info.plist');
  const plist = await readPlist(plistPath);
  const exeName = typeof plist.CFBundleExecutable === 'string' ? plist.CFBundleExecutable : null;
  if (!exeName) throw new Error(`No CFBundleExecutable in ${plistPath}`);
  const executable = join(installPath, 'Contents', 'MacOS', exeName);
  await stat(executable);
  return {
    installPath,
    executable,
    version: typeof plist.CFBundleShortVersionString === 'string' ? plist.CFBundleShortVersionString : null,
    bundleId: typeof plist.CFBundleIdentifier === 'string' ? plist.CFBundleIdentifier : null,
    arch: await archOf(executable),
  };
}

const PLIST_KEYS = ['CFBundleExecutable', 'CFBundleShortVersionString', 'CFBundleIdentifier'] as const;

/**
 * Reads only the string keys we need. (Converting the whole plist to JSON
 * fails on plists that contain <date> or <data> values.)
 */
async function readPlist(path: string): Promise<Record<string, unknown>> {
  if (!isMac) throw new Error('Reading .app bundles requires macOS');
  const out: Record<string, unknown> = {};
  const results = await Promise.all(PLIST_KEYS.map((key) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path])));
  results.forEach((r, i) => {
    if (r.code === 0) out[PLIST_KEYS[i]!] = r.stdout.replace(/\n$/, '');
  });
  if (!out.CFBundleExecutable) {
    const check = await run('/usr/bin/plutil', ['-lint', path]);
    if (check.code !== 0) throw new Error(`Couldn't read ${path}: ${check.stdout.trim() || check.stderr.trim()}`);
  }
  return out;
}

async function archOf(executable: string): Promise<string[]> {
  if (!isMac) return [process.arch];
  const r = await run('/usr/bin/lipo', ['-archs', executable]);
  return r.code === 0 ? r.stdout.trim().split(/\s+/) : [];
}

/**
 * Gatekeeper and placement checks. Downloaded apps carry com.apple.quarantine;
 * if they aren't notarized, spawning them from Arcadia can fail without any dialog.
 */
export async function gatekeeperIssues(app: ResolvedApp, label: string): Promise<Issue[]> {
  if (!isMac) return [];
  const issues: Issue[] = [];

  if (app.installPath.includes('/AppTranslocation/')) {
    issues.push({ level: 'error', message: `${label} is running from a temporary "translocated" copy. Move it to /Applications and select it again.`, fix: 'revealInFinder' });
  }

  if (app.installPath.endsWith('.app')) {
    const quarantined = (await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', app.installPath])).code === 0;
    if (quarantined) {
      const assess = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', app.installPath]);
      if (assess.code !== 0) {
        issues.push({
          level: 'error',
          message: `macOS will block ${label}. Open it once from Finder, then allow it in System Settings → Privacy & Security → "Open Anyway".`,
          fix: 'openPrivacySettings',
        });
      } else {
        issues.push({ level: 'warn', message: `${label} hasn't been opened yet. Open it once from Finder so macOS finishes its first-launch check.`, fix: 'openEmulator' });
      }
    }
  }

  if (app.arch.length > 0 && !app.arch.includes('arm64')) {
    issues.push({ level: 'warn', message: `${label} is an Intel build and will run under Rosetta 2, which is noticeably slower.` });
  }
  return issues;
}

/** Common install locations, used only to *suggest* paths. Nothing is hardcoded into launches. */
export function candidateAppDirs(home: string): string[] {
  return ['/Applications', join(home, 'Applications'), join(home, 'Downloads')];
}
