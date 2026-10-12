import { create } from 'zustand';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { ControllerStatus, EmulatorStatus, Game, ScanProgress, SessionState } from '@shared/types';
import { api } from '../api';
import { setInputEnabled } from '../input/input';
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
  settings: Settings | null;
  games: Game[];
  focusedGameId: string | null;
  session: SessionState;
  scan: ScanProgress | null;
  emulators: EmulatorStatus[];
  controller: ControllerStatus;
  toasts: Toast[];

  setScreen(s: Screen): void;
  setFocusedGame(id: string | null): void;
  updateSettings(patch: SettingsPatch): Promise<void>;
  rescan(): Promise<void>;
  refreshEmulators(): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  ready: false,
  screen: 'home',
  settings: null,
  games: [],
  focusedGameId: null,
  session: { kind: 'idle' },
  scan: null,
  emulators: [],
  controller: { helper: 'unavailable', controllers: [] },
  toasts: [],

  setScreen: (screen) => set({ screen }),
  setFocusedGame: (focusedGameId) => set({ focusedGameId }),

  async updateSettings(patch) {
    const settings = await api.invoke('settings:update', patch);
    configureSfx({ enabled: settings.ui.sounds, volume: settings.ui.volume });
    set({ settings });
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
export async function bootstrap(): Promise<void> {
  const [settings, games, session, controller] = await Promise.all([
    api.invoke('settings:get'),
    api.invoke('library:list'),
    api.invoke('session:get'),
    api.invoke('controller:status'),
  ]);
  configureSfx({ enabled: settings.ui.sounds, volume: settings.ui.volume });
  useStore.setState({ settings, games, session, controller, focusedGameId: games[0]?.id ?? null, ready: true });

  api.on('session:state', (s) => {
    useStore.setState({ session: s });
    // The launcher ignores the controller while a game has it.
    setInputEnabled(s.kind === 'idle' || s.kind === 'ended');
    if (s.kind === 'ended' && s.error) {
      useStore.getState().toast({ level: 'error', title: s.error, ...(s.stderrTail ? { detail: s.stderrTail } : {}) });
    }
  });
  api.on('library:progress', async (p) => {
    useStore.setState({ scan: p.phase === 'done' ? null : p });
    if (p.phase === 'done') {
      const games = await api.invoke('library:list');
      const { focusedGameId } = useStore.getState();
      useStore.setState({ games, focusedGameId: games.some((g) => g.id === focusedGameId) ? focusedGameId : (games[0]?.id ?? null) });
    }
  });
  api.on('controller:status', (controller) => useStore.setState({ controller }));
}
