/**
 * Live checks against the real download sources. Skipped unless enabled:
 *   LIVE_SOURCES=1  resolve each emulator's latest macOS release
 *   LIVE_INSTALL=1  also download, verify and install them (macOS only)
 * CI runs both on the macOS job.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/main/install/catalog';
import { Installer, type StreamFetch } from '../src/main/install/installer';
import { resolveRelease, type JsonFetch } from '../src/main/install/resolve';
import { run } from '../src/main/util/exec';

const fetchJson = fetch as unknown as JsonFetch;
const ids = ['dolphin', 'ryubing', 'xemu'] as const;

describe.skipIf(!process.env.LIVE_SOURCES)('live: release sources', () => {
  for (const id of ids) {
    it(`resolves ${id}`, async () => {
      const r = await resolveRelease(CATALOG[id], fetchJson);
      console.log(`${id}: ${r.version} from ${r.source} → ${r.url} (sha256 ${r.sha256 ? 'yes' : 'no'})`);
      expect(r.url).toMatch(/^https:\/\//);
    }, 30_000);
  }
});

describe.skipIf(!process.env.LIVE_INSTALL || process.platform !== 'darwin')('live: install', () => {
  for (const id of ids) {
    it(`installs ${id}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'arcadia-live-'));
      const installer = new Installer(root, join(root, 'Applications'), fetchJson, fetch as unknown as StreamFetch);
      const phases: string[] = [];
      const path = await installer.install(id, (p) => {
        if (phases.at(-1) !== p.phase) phases.push(p.phase);
        if (p.phase === 'done' || p.phase === 'error') console.log(`${id}: ${p.phase} ${p.version ?? ''} ${p.message ?? ''}`);
      });
      console.log(`${id}: installed at ${path} via ${phases.join(' → ')}`);
      expect((await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], 60_000)).code).toBe(0);
      const assess = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', path]);
      console.log(`${id}: Gatekeeper → ${(assess.stderr || assess.stdout).trim()}`);
    }, 600_000);
  }
});
