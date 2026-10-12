import { lstat, mkdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

/** Create `link → target` unless something already exists at `link`. */
export async function ensureSymlink(target: string, link: string): Promise<'created' | 'exists'> {
  try {
    await lstat(link);
    return 'exists';
  } catch {
    await mkdir(dirname(link), { recursive: true });
    await symlink(target, link);
    return 'created';
  }
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? `${home}${p.slice(1)}` : p;
}
