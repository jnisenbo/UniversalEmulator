import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/shared/settings';
import { SettingsStore, salvageSettings } from '../src/main/settings/store';
import { writeFileAtomic } from '../src/main/util/fsx';
import { isNewer } from '../src/shared/version';
import { expandArgs } from '../src/main/emulators/xenia/adapter';
import { LibraryCache } from '../src/main/library/cache';
import { scanLibrary } from '../src/main/library/scanner';
import { PlayHistory } from '../src/main/library/history';
import { SessionManager } from '../src/main/session/session';
import type { EmulatorAdapter } from '../src/main/emulators/adapter';
import type { Game, SessionState } from '../src/shared/types';

const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'arcadia-audit-'));

describe('settings file resilience', () => {
  it('keeps every valid section when one value is invalid', () => {
    const s = salvageSettings({
      libraryFolders: ['/Volumes/Games'],
      emulators: { dolphin: { appPath: '/Applications/Dolphin.app' } },
      ui: { volume: 1.2, sounds: false },
      metadata: { steamGridDbKey: 'abc' },
    });
    expect(s.libraryFolders).toEqual(['/Volumes/Games']);
    expect(s.emulators.dolphin.appPath).toBe('/Applications/Dolphin.app');
    expect(s.metadata.steamGridDbKey).toBe('abc');
    expect(s.ui.sounds).toBe(false); // valid field in the same section survives
    expect(s.ui.volume).toBe(0.5); // invalid field falls back
  });

  it('backs up an unreadable file instead of silently discarding it', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ version: 2, libraryFolders: ['/g'] }));
    const store = new SettingsStore(dir);
    const s = await store.load();
    expect(s.libraryFolders).toEqual(['/g']);
    expect((await readdir(dir)).some((f) => f.startsWith('settings.json.invalid-'))).toBe(true);
  });

  it('serializes overlapping writes so the file is always valid JSON with the last value', async () => {
    const dir = await tmp();
    const file = join(dir, 'settings.json');
    const long = JSON.stringify({ a: 'x'.repeat(50_000) });
    await Promise.all([writeFileAtomic(file, long), writeFileAtomic(file, '{"a":1}'), writeFileAtomic(file, long), writeFileAtomic(file, '{"b":2}')]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ b: 2 });
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('salvages nested fields and list items individually', () => {
    const s = salvageSettings({
      emulators: { dolphin: { appPath: '/Applications/Dolphin.app', dataDir: 5 } },
      libraryFolders: ['/a', 42, '/b'],
      controller: { layout: { south: 'east', east: 'nope' } },
    });
    expect(s.emulators.dolphin.appPath).toBe('/Applications/Dolphin.app');
    expect(s.emulators.dolphin.dataDir).toBeNull();
    expect(s.libraryFolders).toEqual(['/a', '/b']);
    expect(s.controller.layout).toEqual({ south: 'east' });
  });

  it('defaults are valid', () => {
    expect(SettingsSchema.safeParse(salvageSettings(null)).success).toBe(true);
  });
});

describe('update offers', () => {
  it('only offers genuinely newer versions', () => {
    expect(isNewer('2612', '2609a')).toBe(true);
    expect(isNewer('2609a', '2609')).toBe(true);
    expect(isNewer('1.3.2', '1.3.3 (Canary)')).toBe(false);
    expect(isNewer('0.8.136', '0.8.136')).toBe(false);
    expect(isNewer('0.8.140', '0.8.136')).toBe(true);
    expect(isNewer('1.3.3 (Canary)', '1.3.3')).toBe(false);
  });
});

describe('xenia arguments', () => {
  it('keeps $ sequences in game paths literally', () => {
    expect(expandArgs('--target={game}', '/Games/Rock $& Roll.iso')).toEqual(['--target=/Games/Rock $& Roll.iso']);
  });
});

describe('library scanning', () => {
  it('follows symlinked folders and files, and survives link loops', async () => {
    const root = await tmp();
    const external = await tmp();
    const disc = Buffer.alloc(0x80);
    disc.write('GALE01', 0, 'latin1');
    disc.writeUInt32BE(0xc2339f3d, 0x1c);
    disc.write('Melee', 0x20, 'latin1');
    await writeFile(join(external, 'melee.iso'), disc);
    await mkdir(join(root, 'lib'));
    await symlink(external, join(root, 'lib', 'External'));
    await symlink(join(external, 'melee.iso'), join(root, 'lib', 'linked.iso'));
    await symlink(join(root, 'lib'), join(root, 'lib', 'loop'));
    const cache = new LibraryCache(await tmp());
    const summary = await scanLibrary([join(root, 'lib')], cache, { switchHeaderKey: null }, () => undefined);
    // The symlinked file and its target are one game, not two.
    expect(summary.games).toBe(1);
    expect(cache.games().every((g) => g.gameId === 'GALE01')).toBe(true);
  });
});

describe('play history file', () => {
  it('ignores damaged records instead of failing later saves', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'history.json'), 'null');
    const h = new PlayHistory(dir);
    await h.load();
    expect(h.all()).toEqual({});
    await writeFile(join(dir, 'history.json'), JSON.stringify({ good: { lastPlayed: 1, totalMs: 2, sessions: 1 }, bad: { lastPlayed: 'x' } }));
    await h.load();
    expect(Object.keys(h.all())).toEqual(['good']);
  });
});

describe('session crash detection', () => {
  it('reports an emulator killed by a signal as a crash', async () => {
    const adapter: EmulatorAdapter = {
      id: 'xenia',
      platforms: ['xbox360'],
      bundleNames: [],
      installPath: () => '/bin/sh',
      detect: async () => ({ id: 'xenia', configured: true, installPath: '/bin/sh', executable: '/bin/sh', version: null, arch: [], issues: [] }),
      writeConfig: async () => ({ warnings: [] }),
      getLaunchArgs: () => ({ executable: '/bin/sh', args: ['-c', 'kill -SEGV $$'] }),
    };
    const session = new SessionManager();
    const states: SessionState[] = [];
    session.on('state', (s) => states.push(s));
    const game = { id: 'g', emulator: 'xenia' } as Game;
    const ended = new Promise<SessionState>((resolve) => session.on('state', (s) => s.kind === 'ended' && resolve(s)));
    await session.launch(game, adapter, { settings: SettingsSchema.parse({}), managedDir: await tmp(), home: '/tmp' }, SettingsSchema.parse({}).controller);
    const end = await ended;
    expect(end).toMatchObject({ kind: 'ended', signal: 'SIGSEGV' });
    expect((end as { error?: string }).error).toMatch(/crashed \(SIGSEGV\)/);
  });
});
