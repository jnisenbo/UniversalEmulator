import { create } from 'zustand';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { EmulatorId } from '@shared/platforms';
import type { ControllerStatus, EmulatorStatus, Game, GameArt, InstallInfo, InstallProgress, ScanProgress, SessionState } from '@shared/types';
import { api } from '../api';
import { setButtonLayout, setInputEnabled } from '../input/input';
import { configureSfx } from '../sound/sfx';

export type Screen = 'home' | 'settings';

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  title: string;
  detail?: string;
}

interface State {
  ready: boolean;
  screen: Screen;
  /** Settings section to open next time Settings is shown. */
  settingsSection: string | null;
  settings: Settings | null;
  games: Game[];
  focusedGameId: string | null;
  session: SessionState;
  scan: ScanProgress | null;
  emulators: EmulatorStatus[];
  controller: ControllerStatus;
  toasts: Toast[];
  art: Record<string, GameArt>;
  installs: InstallInfo[];
  installProgress: Partial<Record<EmulatorId, InstallProgress>>;

  setScreen(s: Screen): void;
  openSettings(section: string): void;
  setFocusedGame(id: string | null): void;
  updateSettings(patch: SettingsPatch): Promise<void>;
  rescan(): Promise<void>;
  refreshEmulators(): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  refreshInstalls(checkLatest: boolean): Promise<void>;
  install(id: EmulatorId): Promise<boolean>;
  installFromFile(id: EmulatorId): Promise<boolean>;
}

let toastId = 0;

function applySettings(settings: Settings): void {
  configureSfx({ enabled: settings.ui.sounds, volume: settings.ui.volume });
  setButtonLayout(settings.controller.layout);
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  screen: 'home',
  settingsSection: null,
  settings: null,
  games: [],
  focusedGameId: null,
  session: { kind: 'idle' },
  scan: null,
  emulators: [],
  controller: { helper: 'unavailable', controllers: [] },
  toasts: [],
  art: {},
  installs: [],
  installProgress: {},

  setScreen: (screen) => set({ screen }),
  openSettings: (section) => set({ screen: 'settings', settingsSection: section }),
  setFocusedGame: (focusedGameId) => set({ focusedGameId }),

  async updateSettings(patch) {
    const settings = await api.invoke('settings:update', patch);
    applySettings(settings);
    set({ settings });
  },

  async refreshInstalls(checkLatest) {
    set({ installs: await api.invoke('emulators:installInfo', { checkLatest }) });
  },

  async installFromFile(id) {
    const r = await api.invoke('emulators:installFromFile', { id });
    if (r.cancelled) return false;
    if (!r.ok) get().toast({ level: 'error', title: 'Install failed', ...(r.error ? { detail: r.error } : {}) });
    const [settings] = await Promise.all([api.invoke('settings:get'), get().refreshInstalls(false), get().refreshEmulators()]);
    set({ settings });
    return r.ok;
  },

  async install(id) {
    const r = await api.invoke('emulators:install', { id });
    if (!r.ok) get().toast({ level: 'error', title: 'Install failed', ...(r.error ? { detail: r.error } : {}) });
    const [settings] = await Promise.all([api.invoke('settings:get'), get().refreshInstalls(false), get().refreshEmulators()]);
    set({ settings });
    return r.ok;
  },

  async rescan() {
    const summary = await api.invoke('library:scan');
    const games = await api.invoke('library:list');
    set({ games, focusedGameId: get().focusedGameId ?? games[0]?.id ?? null });
    if (summary.errors.length) get().toast({ level: 'warn', title: `Some folders couldn't be read`, detail: summary.errors.slice(0, 3).join('\n') });
  },

  async refreshEmulators() {
    set({ emulators: await api.invoke('emulators:status') });
  },

  toast(t) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.level === 'error' ? 9000 : 5000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Load initial state and subscribe to main-process events. */
export async function bootstrap(opts: { overlay?: boolean } = {}): Promise<void> {
  const [settings, games, session, controller, art] = await Promise.all([
    api.invoke('settings:get'),
    api.invoke('library:list'),
    api.invoke('session:get'),
    api.invoke('controller:status'),
    api.invoke('art:all'),
  ]);
  applySettings(settings);
  useStore.setState({ settings, games, session, controller, art, focusedGameId: games[0]?.id ?? null, ready: true });
  void useStore.getState().refreshInstalls(false);
  void useStore.getState().refreshEmulators();

  api.on('session:state', (s) => {
    useStore.setState({ session: s });
    // The launcher ignores the controller while a game has it (the in-game menu doesn't).
    if (!opts.overlay) setInputEnabled(s.kind === 'idle' || s.kind === 'ended');
    if (s.kind === 'ended' && s.error && !opts.overlay) {
      useStore.getState().toast({ level: 'error', title: s.error, ...(s.stderrTail ? { detail: s.stderrTail } : {}) });
    }
  });
  api.on('library:progress', async (p) => {
    useStore.setState({ scan: p.phase === 'done' ? null : p });
    if (p.phase === 'done') {
      const [games, art] = await Promise.all([api.invoke('library:list'), api.invoke('art:all')]);
      useStore.setState({ art });
      const { focusedGameId } = useStore.getState();
      useStore.setState({ games, focusedGameId: games.some((g) => g.id === focusedGameId) ? focusedGameId : (games[0]?.id ?? null) });
    }
  });
  api.on('controller:status', (controller) => useStore.setState({ controller }));
  api.on('art:updated', ({ gameId, art }) => {
    const next = { ...useStore.getState().art };
    if (art) next[gameId] = art;
    else delete next[gameId];
    useStore.setState({ art: next });
  });
  api.on('emulators:installProgress', (p) => useStore.setState({ installProgress: { ...useStore.getState().installProgress, [p.id]: p } }));
}
