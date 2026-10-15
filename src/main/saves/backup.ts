import { copyFile, lstat, mkdir, readdir, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunnerId } from '@shared/platforms';
import type { Settings } from '@shared/settings';
import { defaultPcsx2DataDir } from '../emulators/pcsx2/adapter';
import { defaultRetroArchDataDir } from '../emulators/retroarch/adapter';
import { defaultRpcs3DataDir } from '../emulators/rpcs3/adapter';
import { defaultRyubingDataDir } from '../emulators/ryubing/adapter';

export interface SaveSource {
  emulator: RunnerId;
  /** Folder name in the backup, e.g. "Dolphin/GC". */
  label: string;
  dir: string;
}

export interface BackupResult {
  copied: number;
  bytes: number;
  errors: string[];
  folder: string;
}

/** Files bigger than this aren't saves (disc images, hard disk images). */
const MAX_FILE = 1024 * 1024 * 1024;

/** Where backups go: your choice, else iCloud Drive if it's on, else Documents. */
export async function backupFolder(s: Settings, home: string): Promise<string> {
  if (s.saves.folder) return s.saves.folder;
  const icloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const hasICloud = await stat(icloud).then((x) => x.isDirectory()).catch(() => false);
  return join(hasICloud ? icloud : join(home, 'Documents'), 'Arcadia Saves');
}

/** Save folders for each emulator. xemu keeps saves inside its hard disk image, so it isn't listed. */
export function saveSources(s: Settings, home: string): SaveSource[] {
  const appSupport = join(home, 'Library', 'Application Support');
  const dolphin = s.emulators.dolphin.dataDir ?? join(appSupport, 'Dolphin');
  const pcsx2 = s.emulators.pcsx2.dataDir ?? defaultPcsx2DataDir(home);
  const rpcs3 = s.emulators.rpcs3.dataDir ?? defaultRpcs3DataDir(home);
  const ryubing = s.emulators.ryubing.dataDir ?? defaultRyubingDataDir(home);
  const retroarch = s.emulators.retroarch.dataDir ?? defaultRetroArchDataDir(home);
  return [
    { emulator: 'dolphin', label: 'Dolphin/GameCube memory cards', dir: join(dolphin, 'GC') },
    { emulator: 'dolphin', label: 'Dolphin/Wii saves', dir: join(dolphin, 'Wii', 'title') },
    { emulator: 'dolphin', label: 'Dolphin/Save states', dir: join(dolphin, 'StateSaves') },
    { emulator: 'pcsx2', label: 'PCSX2/Memory cards', dir: join(pcsx2, 'memcards') },
    { emulator: 'pcsx2', label: 'PCSX2/Save states', dir: join(pcsx2, 'sstates') },
    { emulator: 'rpcs3', label: 'RPCS3/Saves', dir: join(rpcs3, 'dev_hdd0', 'home', '00000001', 'savedata') },
    { emulator: 'rpcs3', label: 'RPCS3/Save states', dir: join(rpcs3, 'savestates') },
    { emulator: 'ryubing', label: 'Switch/Saves', dir: join(ryubing, 'bis', 'user', 'save') },
    { emulator: 'xenia', label: 'Xenia/Profiles and saves', dir: join(home, '.local', 'share', 'Xenia', 'content') },
    { emulator: 'retroarch', label: 'RetroArch/Saves', dir: join(retroarch, 'saves') },
    { emulator: 'retroarch', label: 'RetroArch/Save states', dir: join(retroarch, 'states') },
  ];
}

/**
 * Copy new and changed files into the backup. Never deletes anything from the
 * backup, so a save lost in an emulator is still there.
 */
async function sync(src: string, dest: string, result: BackupResult, depth = 0): Promise<void> {
  if (depth > 12) return;
  let entries;
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') result.errors.push(`${src}: ${(err as Error).message}`);
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const from = join(src, e.name);
    const to = join(dest, e.name);
    try {
      // Follow links (Arcadia's own emulator folders link to the real save folders).
      const info = e.isSymbolicLink() ? await stat(from) : await lstat(from);
      if (info.isDirectory()) {
        await sync(from, to, result, depth + 1);
        continue;
      }
      if (!info.isFile() || info.size > MAX_FILE) continue;
      const existing = await stat(to).catch(() => null);
      if (existing && existing.size === info.size && existing.mtimeMs >= info.mtimeMs - 1000) continue;
      await mkdir(dest, { recursive: true });
      await copyFile(from, to);
      await utimes(to, info.atime, info.mtime);
      result.copied++;
      result.bytes += info.size;
    } catch (err) {
      result.errors.push(`${from}: ${(err as Error).message}`);
    }
  }
}

export async function backupSaves(sources: SaveSource[], folder: string): Promise<BackupResult> {
  const result: BackupResult = { copied: 0, bytes: 0, errors: [], folder };
  for (const s of sources) await sync(s.dir, join(folder, ...s.label.split('/')), result);
  return result;
}
