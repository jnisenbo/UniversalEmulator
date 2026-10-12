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
];

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
    'settings:update': (patch) => (settings = { ...settings, ...(patch as Partial<Settings>), controller: { ...settings.controller, ...(patch.controller ?? {}) }, ui: { ...settings.ui, ...(patch.ui ?? {}) } } as Settings),
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
