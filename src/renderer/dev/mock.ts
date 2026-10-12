import type { ArcadiaApi, EventChannel, IpcEvents, IpcRequests, RequestChannel } from '@shared/ipc';
import { PLATFORM_INFO, type Platform } from '@shared/platforms';
import { defaultSettings, type Settings } from '@shared/settings';
import type { Game, SessionState } from '@shared/types';

const SAMPLE: [string, Platform, string, string][] = [
  ['Super Mario Galaxy', 'wii', 'RMGE01', 'rvz'],
  ['The Legend of Zelda: Breath of the Wild', 'switch', '01007EF00011E000', 'nsp'],
  ['Metroid Prime', 'gamecube', 'GM8E01', 'iso'],
  ['Halo 3', 'xbox360', '4D5307E6', 'xiso'],
  ['Mario Kart 8 Deluxe', 'switch', '0100152000022000', 'xci'],
  ['Super Smash Bros. Melee', 'gamecube', 'GALE01', 'rvz'],
  ['Xenoblade Chronicles', 'wii', 'SX4E01', 'wbfs'],
  ['Red Dead Redemption', 'xbox360', '5454082B', 'xiso'],
  ['Wind Waker', 'gamecube', 'GZLE01', 'gcz'],
  ['Super Mario Odyssey', 'switch', '0100000000010000', 'nsp'],
  ['Donkey Kong Country Returns', 'wii', 'SF8E01', 'rvz'],
  ['Halo: Combat Evolved', 'xbox', '4D530004', 'xiso'],
];

function deepMerge(base: unknown, patch: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = k === 'layout' ? v : deepMerge(out[k], v);
  return out;
}

/** Development stand-in for the preload API; never shipped in the Electron build path. */
export function createMockApi(): ArcadiaApi {
  let settings: Settings = { ...defaultSettings(), libraryFolders: ['/Volumes/Games'] };
  const games: Game[] = SAMPLE.map(([title, platform, gameId, format], i) => ({
    id: `mock${i}`,
    path: `/Volumes/Games/${title}.${format}`,
    fileName: `${title}.${format}`,
    displayTitle: title,
    title,
    platform,
    format: format as Game['format'],
    gameId,
    discNumber: 0,
    identified: true,
    sizeBytes: 4_400_000_000,
    emulator: PLATFORM_INFO[platform].emulator,
  }));
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = <C extends EventChannel>(c: C, p: IpcEvents[C]): void => listeners.get(c)?.forEach((l) => l(p));
  let session: SessionState = { kind: 'idle' };

  const handlers: { [C in RequestChannel]: (req: IpcRequests[C]['req']) => IpcRequests[C]['res'] | Promise<IpcRequests[C]['res']> } = {
    'settings:get': () => settings,
    'settings:update': (patch) => (settings = deepMerge(settings, patch) as Settings),
    'library:list': () => games,
    'library:scan': async () => {
      for (let i = 0; i <= games.length; i++) {
        emit('library:progress', { phase: 'probing', scanned: i, total: games.length });
        await new Promise((r) => setTimeout(r, 60));
      }
      emit('library:progress', { phase: 'done', scanned: games.length, total: games.length });
      return { games: games.length, added: 0, removed: 0, unidentified: 0, errors: [] };
    },
    'emulators:status': () => [
      { id: 'dolphin', configured: true, installPath: '/Applications/Dolphin.app', executable: '', version: '2509', arch: ['arm64'], issues: [] },
      { id: 'ryubing', configured: true, installPath: '/Applications/Ryujinx.app', executable: '', version: '1.3.3', arch: ['arm64'], issues: [{ level: 'warn', message: "Ryujinx.app hasn't been opened yet. Open it once from Finder so macOS finishes its first-launch check.", fix: 'openEmulator' }] },
      { id: 'xenia', configured: false, installPath: null, executable: null, version: null, arch: [], issues: [{ level: 'error', message: 'Choose where Xenia / XeniOS is installed.' }] },
    ],
    'emulators:autodetect': () => ({ dolphin: '/Applications/Dolphin.app' }),
    'game:launch': async ({ gameId }) => {
      const g = games.find((x) => x.id === gameId)!;
      session = { kind: 'launching', gameId, emulator: g.emulator };
      emit('session:state', session);
      await new Promise((r) => setTimeout(r, 900));
      session = { kind: 'running', gameId, emulator: g.emulator, pid: 1, startedAt: Date.now() };
      emit('session:state', session);
      setTimeout(() => {
        emit('session:state', { kind: 'ended', gameId, emulator: g.emulator, exitCode: 0, signal: null, playedMs: 3000 });
        emit('session:state', (session = { kind: 'idle' }));
      }, 3000);
      return { ok: true, warnings: [] };
    },
    'session:get': () => session,
    'session:quit': () => undefined,
    'dialog:pick': () => '/Users/me/Games',
    'controller:status': () => ({ helper: 'running', controllers: [{ id: '0', name: 'DualSense Wireless Controller', isDualSense: true, battery: 0.72, charging: false }] }),
    'controller:pair': () => {
      const steps: IpcEvents['controller:pair'][] = [{ phase: 'searching' }, { phase: 'found', name: 'DualSense Wireless Controller' }, { phase: 'pairing', name: 'DualSense Wireless Controller' }, { phase: 'connected', name: 'DualSense Wireless Controller' }];
      steps.forEach((s, i) => setTimeout(() => emit('controller:pair', s), 900 * (i + 1)));
    },
    'controller:cancelPair': () => emit('controller:pair', { phase: 'cancelled' }),
    'controller:setLight': () => undefined,
    'system:openSettingsPane': () => undefined,
    'app:quit': () => undefined,
    'emulators:installInfo': ({ checkLatest }) =>
      (['dolphin', 'ryubing', 'xemu', 'xenia'] as const).map((id) => ({
        id,
        installable: id !== 'xenia',
        homepage: 'https://example.invalid/',
        managedVersion: id === 'dolphin' ? '2509' : null,
        latestVersion: checkLatest && id !== 'xenia' ? (id === 'dolphin' ? '2512' : '1.0') : null,
        ...(id === 'ryubing' ? { firstRun: 'Open Ryubing once and install the keys and firmware dumped from your own Switch.' } : {}),
      })),
    'emulators:install': async ({ id }) => {
      const total = 80_000_000;
      for (const phase of ['resolving', 'downloading', 'verifying', 'extracting', 'installing'] as const) {
        if (phase === 'downloading') {
          for (let r = 0; r <= total; r += total / 8) {
            emit('emulators:installProgress', { id, phase, received: r, total, version: '1.0' });
            await new Promise((res) => setTimeout(res, 120));
          }
        } else {
          emit('emulators:installProgress', { id, phase, version: '1.0' });
          await new Promise((res) => setTimeout(res, 300));
        }
      }
      emit('emulators:installProgress', { id, phase: 'done', version: '1.0' });
      settings = { ...settings, emulators: { ...settings.emulators, [id]: { ...settings.emulators[id], appPath: `/Users/me/Applications/${id}.app` } } };
      return { ok: true, path: `/Users/me/Applications/${id}.app` };
    },
    'emulators:installFromFile': () => ({ ok: false, cancelled: true }),
    'emulators:openApp': () => undefined,
    'emulators:openHomepage': () => undefined,
    'art:all': () => ({}),
    'history:all': () => ({
      'switch-0100152000022000': { lastPlayed: Date.now() - 3_600_000, totalMs: 12_400_000, sessions: 9 },
      'wii-rmge01': { lastPlayed: Date.now() - 86_400_000 * 1.2, totalMs: 4_100_000, sessions: 3 },
    }),
    'art:refresh': () => null,
    'art:search': ({ gameId }) => {
      const g = games.find((x) => x.id === gameId);
      return [
        { id: 1, name: g?.displayTitle ?? 'Game', year: 2007 },
        { id: 2, name: `${g?.displayTitle ?? 'Game'} (Demo)`, year: 2007 },
        { id: 3, name: `${g?.displayTitle ?? 'Game'} HD`, year: 2019 },
      ];
    },
    'game:reveal': () => undefined,
    'overlay:resume': () => undefined,
    'overlay:quitGame': () => undefined,
  };

  return {
    platform: 'darwin',
    invoke: (async (channel: RequestChannel, req?: unknown) => (handlers[channel] as (r: unknown) => unknown)(req)) as ArcadiaApi['invoke'],
    on: ((channel: EventChannel, fn: (p: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(fn);
      listeners.set(channel, set);
      return () => set.delete(fn);
    }) as ArcadiaApi['on'],
  };
}
