import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrangeLibrary, formatLastPlayed, formatPlayTime, gameKey } from '../src/shared/library';
import { SettingsSchema } from '../src/shared/settings';
import type { Game } from '../src/shared/types';
import { groupDiscs } from '../src/main/library/discs';
import { PlayHistory } from '../src/main/library/history';
import { dolphinAdapter } from '../src/main/emulators/dolphin/adapter';
import { applyDolphinIni } from '../src/main/emulators/dolphin/config';
import { mergeSettings as mergeOneLevel } from '../src/shared/merge';

function game(over: Partial<Game>): Game {
  return {
    id: over.path ?? 'x',
    path: '/g/x.iso',
    fileName: 'x.iso',
    displayTitle: 'X',
    title: 'X',
    platform: 'gamecube',
    format: 'iso',
    gameId: 'GXXE01',
    discNumber: 0,
    identified: true,
    sizeBytes: 1,
    emulator: 'dolphin',
    ...over,
  };
}

describe('multi-disc games', () => {
  it('groups discs of the same game into one entry, in disc order', () => {
    const out = groupDiscs([
      game({ path: '/g/RE4 (Disc 2).iso', discNumber: 1, gameId: 'G4BE08', displayTitle: 'RE4' }),
      game({ path: '/g/RE4 (Disc 1).iso', discNumber: 0, gameId: 'G4BE08', displayTitle: 'RE4' }),
      game({ path: '/g/Melee.iso', gameId: 'GALE01' }),
    ]);
    expect(out).toHaveLength(2);
    const re4 = out.find((g) => g.gameId === 'G4BE08')!;
    expect(re4.path).toBe('/g/RE4 (Disc 1).iso');
    expect(re4.discPaths).toEqual(['/g/RE4 (Disc 1).iso', '/g/RE4 (Disc 2).iso']);
  });

  it('keeps duplicate copies of one disc as separate entries', () => {
    const out = groupDiscs([game({ path: '/a.iso' }), game({ path: '/b.rvz' })]);
    expect(out).toHaveLength(2);
    expect(out.every((g) => !g.discPaths)).toBe(true);
  });

  it('boots grouped discs from an m3u with automatic disc change', async () => {
    const managedDir = await mkdtemp(join(tmpdir(), 'arcadia-'));
    const ctx = { settings: SettingsSchema.parse({}), managedDir, home: '/Users/me' };
    const g = game({ gameId: 'G4BE08', discPaths: ['/g/d1.iso', '/g/d2.iso'] });
    await dolphinAdapter.prepareGame!(g, ctx);
    const spec = dolphinAdapter.getLaunchArgs(g, { installPath: '', executable: '/D', version: null, bundleId: null, arch: [] }, ctx);
    const m3u = spec.args[spec.args.indexOf('-e') + 1]!;
    expect(m3u).toMatch(/G4BE08\.m3u$/);
    expect(await readFile(m3u, 'utf8')).toBe('/g/d1.iso\n/g/d2.iso\n');
    expect(applyDolphinIni(new Map()).get('Core')!.get('AutoDiscChange')).toBe('True');
  });
});

describe('library order and filter', () => {
  const a = game({ id: 'a', displayTitle: 'Alpha', gameId: 'AAAA01' });
  const b = game({ id: 'b', displayTitle: 'Bravo', gameId: 'BBBB01', platform: 'wii' });
  const c = game({ id: 'c', displayTitle: 'Charlie', gameId: '0100000000010000', platform: 'switch' });
  const history = { [gameKey(c)]: { lastPlayed: 200, totalMs: 1, sessions: 1 }, [gameKey(b)]: { lastPlayed: 100, totalMs: 1, sessions: 1 } };

  it('puts recently played first, newest first, then the rest by title', () => {
    expect(arrangeLibrary([a, b, c], history, 'recent', 'all').map((g) => g.id)).toEqual(['c', 'b', 'a']);
    expect(arrangeLibrary([c, b, a], history, 'title', 'all').map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters to one console', () => {
    expect(arrangeLibrary([a, b, c], history, 'recent', 'wii').map((g) => g.id)).toEqual(['b']);
  });

  it('formats play time and dates', () => {
    expect(formatPlayTime(30_000)).toBe('Less than a minute');
    expect(formatPlayTime(95 * 60_000)).toBe('1 h 35 min');
    const now = new Date(2026, 9, 12, 20).getTime();
    expect(formatLastPlayed(now - 3_600_000, now)).toBe('today');
    expect(formatLastPlayed(now - 86_400_000, now)).toBe('yesterday');
  });
});

describe('play history', () => {
  it('records sessions over 15 seconds and accumulates time', async () => {
    const h = new PlayHistory(await mkdtemp(join(tmpdir(), 'arcadia-')));
    const g = game({});
    expect(await h.record(g, 5_000)).toBeNull();
    await h.record(g, 60_000, 1000);
    const r = await h.record(g, 120_000, 2000);
    expect(r).toEqual({ lastPlayed: 2000, totalMs: 180_000, sessions: 2 });
    const reloaded = new PlayHistory((h as unknown as { file: string }).file.replace(/\/history\.json$/, ''));
    await reloaded.load();
    expect(reloaded.all()[gameKey(g)]?.sessions).toBe(2);
  });
});

describe('per-game graphics settings', () => {
  it('replaces the override map whole so removing a game works', () => {
    const base = SettingsSchema.parse({ gameGraphics: { 'wii-rmge01': { resolutionScale: 3 } } });
    expect(mergeOneLevel(base, { gameGraphics: {} }).gameGraphics).toEqual({});
    expect(SettingsSchema.parse(mergeOneLevel(base, { gameGraphics: { 'x': { vsync: false } } })).gameGraphics).toEqual({ x: { vsync: false } });
  });

  it('accepts console filters and sort order', () => {
    const s = SettingsSchema.parse({ ui: { filter: 'xbox', sort: 'title' } });
    expect(s.ui).toMatchObject({ filter: 'xbox', sort: 'title' });
  });
});
