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

const writeQueues = new Map<string, Promise<void>>();
let tmpCounter = 0;

/**
 * Write via temp file + rename so a crash never leaves a half-written file.
 * Writes to the same path are queued, and each uses its own temp file, so
 * overlapping saves can't interleave; the last one wins.
 */
export function writeFileAtomic(path: string, data: string): Promise<void> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`;
      await writeFile(tmp, data, 'utf8');
      await rename(tmp, path);
    });
  writeQueues.set(path, next);
  void next.finally(() => {
    if (writeQueues.get(path) === next) writeQueues.delete(path);
  }).catch(() => undefined);
  return next;
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
