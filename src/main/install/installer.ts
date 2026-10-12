import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { EmulatorId } from '@shared/platforms';
import type { InstallProgress } from '@shared/types';
import { run } from '../util/exec';
import { exists, writeFileAtomic } from '../util/fsx';
import { CATALOG, hostAllowed } from './catalog';
import { resolveRelease, type JsonFetch, type Release } from './resolve';

const STALL_MS = 60_000;

export type StreamFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; url?: string; headers: { get(n: string): string | null }; body: ReadableStream<Uint8Array> | null }>;

interface Managed {
  version: string;
  path: string;
  installedAt: number;
  source: string;
}

/**
 * Downloads, verifies and installs emulator apps into ~/Applications.
 * Verification: https + per-emulator host allowlist, SHA-256 from the
 * release source, then codesign --verify on the extracted app.
 */
export class Installer {
  private managed: Partial<Record<EmulatorId, Managed>> = {};
  private busy = new Set<EmulatorId>();

  constructor(
    private readonly userData: string,
    private readonly appsDir: string,
    private readonly fetchJson: JsonFetch,
    private readonly fetchStream: StreamFetch,
  ) {}

  private get indexFile(): string {
    return join(this.userData, 'installs.json');
  }

  async load(): Promise<void> {
    try {
      this.managed = JSON.parse(await readFile(this.indexFile, 'utf8'));
    } catch {
      this.managed = {};
    }
  }

  managedInstall(id: EmulatorId): Managed | null {
    return this.managed[id] ?? null;
  }

  latest(id: EmulatorId): Promise<Release> {
    return resolveRelease(CATALOG[id], this.fetchJson);
  }

  async install(id: EmulatorId, onProgress: (p: InstallProgress) => void): Promise<string> {
    const entry = CATALOG[id];
    if (entry.manualOnly) throw new Error(`Download ${id} from ${entry.homepage}.`);
    if (this.busy.has(id)) throw new Error('Already installing.');
    this.busy.add(id);
    const work = await mkdtemp(join(this.userData, `install-${id}-`));
    try {
      onProgress({ id, phase: 'resolving' });
      const release = await this.latest(id);

      const file = join(work, basename(new URL(release.url).pathname) || 'download');
      const sha = await this.download(release.url, file, entry.hosts, (received, total) => onProgress({ id, phase: 'downloading', received, total, version: release.version }));

      onProgress({ id, phase: 'verifying', version: release.version });
      if (release.sha256 && sha !== release.sha256) throw new Error('The download did not match its published checksum, so it was discarded.');

      onProgress({ id, phase: 'extracting', version: release.version });
      const extracted = join(work, 'x');
      await mkdir(extracted);
      const appSrc = await this.extract(file, extracted, entry.appName);

      onProgress({ id, phase: 'installing', version: release.version });
      const dest = await this.place(id, appSrc, release.source, release.version);
      onProgress({ id, phase: 'done', version: release.version, ...(release.sha256 ? {} : { message: 'No checksum was published for this download; the code signature was verified.' }) });
      return dest;
    } catch (err) {
      onProgress({ id, phase: 'error', message: (err as Error).message });
      throw err;
    } finally {
      this.busy.delete(id);
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Install from an archive the user downloaded themselves (when the automatic
   * download can't reach the source). Same unpacking, signature check and
   * destination as a normal install; there's no published checksum to compare.
   */
  async installFromFile(id: EmulatorId, file: string, onProgress: (p: InstallProgress) => void): Promise<string> {
    const entry = CATALOG[id];
    if (this.busy.has(id)) throw new Error('Already installing.');
    this.busy.add(id);
    const work = await mkdtemp(join(this.userData, `install-${id}-`));
    try {
      onProgress({ id, phase: 'extracting' });
      const extracted = join(work, 'x');
      await mkdir(extracted);
      const appSrc = (await isDir(file)) && file.endsWith('.app') ? file : await this.extract(file, extracted, entry.appName);
      if (!entry.appName.test(basename(appSrc))) throw new Error(`That doesn't look like ${id}: found ${basename(appSrc)}.`);
      const dest = await this.place(id, appSrc, 'file you chose');
      onProgress({ id, phase: 'done', message: 'Installed from your download; the code signature was verified.' });
      return dest;
    } catch (err) {
      onProgress({ id, phase: 'error', message: (err as Error).message });
      throw err;
    } finally {
      this.busy.delete(id);
      await rm(work, { recursive: true, force: true });
    }
  }

  /** Signature check, then copy into ~/Applications and record it. */
  private async place(id: EmulatorId, appSrc: string, source: string, version?: string): Promise<string> {
    const sig = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appSrc], 60_000);
    if (sig.code !== 0) throw new Error(`The app's code signature is invalid: ${sig.stderr.trim().split('\n')[0]}`);
    await mkdir(this.appsDir, { recursive: true });
    const dest = join(this.appsDir, basename(appSrc));
    const previous = this.managed[id];
    // Picking the copy that's already installed: nothing to copy (and deleting
    // the destination first would delete the source).
    if ((await realpath(appSrc).catch(() => appSrc)) === (await realpath(dest).catch(() => dest))) {
      this.managed[id] = { version: previous?.version ?? (await bundleVersion(dest)), path: dest, installedAt: Date.now(), source };
      await writeFileAtomic(this.indexFile, JSON.stringify(this.managed, null, 2));
      return dest;
    }
    if ((await exists(dest)) && previous?.path !== dest) {
      throw new Error(`${dest} already exists and wasn't installed by Arcadia. Use “Choose an installed copy” instead.`);
    }
    await rm(dest, { recursive: true, force: true });
    // ditto preserves symlinks, permissions and code signatures inside the bundle.
    const copy = await run('/usr/bin/ditto', [appSrc, dest], 300_000);
    if (copy.code !== 0) throw new Error(`Copy failed: ${copy.stderr.trim()}`);
    this.managed[id] = { version: version ?? (await bundleVersion(dest)), path: dest, installedAt: Date.now(), source };
    await writeFileAtomic(this.indexFile, JSON.stringify(this.managed, null, 2));
    return dest;
  }

  /** Streams to disk while hashing. Re-checks the host after redirects. */
  private async download(url: string, dest: string, hosts: string[], progress: (received: number, total: number | null) => void): Promise<string> {
    if (!hostAllowed(url, hosts)) throw new Error('Refusing to download from an unexpected host.');
    // Abort if the server stops sending data for a while, rather than hanging forever.
    const abort = new AbortController();
    let stall: NodeJS.Timeout | undefined;
    const armStall = (): void => {
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(), STALL_MS);
    };
    armStall();
    try {
      return await this.stream(url, dest, hosts, progress, abort.signal, armStall);
    } catch (err) {
      if (abort.signal.aborted) throw new Error(`The download stalled for ${STALL_MS / 1000} seconds. Check your connection and try again.`);
      throw err;
    } finally {
      clearTimeout(stall);
    }
  }

  private async stream(url: string, dest: string, hosts: string[], progress: (received: number, total: number | null) => void, signal: AbortSignal, onData: () => void): Promise<string> {
    const res = await this.fetchStream(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
    if (res.url && !hostAllowed(res.url, hosts)) throw new Error('The download redirected to an unexpected host.');
    const total = Number(res.headers.get('content-length')) || null;
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let received = 0;
    let lastEmit = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onData();
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        const now = Date.now();
        if (now - lastEmit > 150) {
          lastEmit = now;
          progress(received, total);
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }
    progress(received, total);
    return hash.digest('hex');
  }

  private async extract(file: string, into: string, appName: RegExp): Promise<string> {
    const lower = file.toLowerCase();
    if (lower.endsWith('.dmg')) {
      const mount = join(into, 'mnt');
      await mkdir(mount);
      const attach = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file], 120_000);
      if (attach.code !== 0) throw new Error(`Couldn't open the disk image: ${attach.stderr.trim()}`);
      try {
        const app = await findApp(mount, appName);
        const copied = join(into, basename(app));
        const copy = await run('/usr/bin/ditto', [app, copied], 300_000);
        if (copy.code !== 0) throw new Error(`Copy failed: ${copy.stderr.trim()}`);
        return copied;
      } finally {
        await run('/usr/bin/hdiutil', ['detach', mount, '-force'], 60_000);
      }
    }
    const r = lower.endsWith('.zip')
      ? await run('/usr/bin/ditto', ['-x', '-k', file, into], 300_000)
      : lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
        ? await run('/usr/bin/tar', ['-xzf', file, '-C', into], 300_000)
        : { code: 1, stdout: '', stderr: 'Unknown archive type' };
    if (r.code !== 0) throw new Error(`Couldn't unpack the download: ${r.stderr.trim()}`);
    return findApp(into, appName);
  }
}

async function bundleVersion(app: string): Promise<string> {
  const r = await run('/usr/bin/defaults', ['read', join(app, 'Contents', 'Info'), 'CFBundleShortVersionString']);
  return r.code === 0 ? r.stdout.trim() : 'unknown';
}

/** Breadth-first search for the .app, a few levels deep. */
export async function findApp(root: string, appName: RegExp, maxDepth = 3): Promise<string> {
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === '__MACOSX') continue;
        const full = join(dir, e.name);
        if (appName.test(e.name)) return full;
        if (!e.name.endsWith('.app')) next.push(full);
      }
    }
    level = next;
  }
  throw new Error('The download did not contain the expected app.');
}

export async function isDir(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null))?.isDirectory() ?? false;
}
