import { app, BrowserWindow, dialog, globalShortcut, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { EventChannel, IpcEvents } from '@shared/ipc';
import type { EmulatorId } from '@shared/platforms';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { Game, ScanSummary } from '@shared/types';
import { HelperClient } from './controller/helper';
import type { AdapterContext } from './emulators/adapter';
import { allAdapters, getAdapter } from './emulators/registry';
import { defaultRyubingDataDir } from './emulators/ryubing/adapter';
import { registerHandlers } from './ipc/register';
import { LibraryCache } from './library/cache';
import { loadHeaderKey } from './library/probes/switch-keys';
import { scanLibrary, sortGames } from './library/scanner';
import { candidateAppDirs } from './platform/macos/bundle';
import { restoreFocus } from './session/focus';
import { SessionManager } from './session/session';
import { SettingsStore } from './settings/store';
import { exists } from './util/fsx';

const isMac = process.platform === 'darwin';
const windowed = !!process.env.ARCADIA_WINDOWED;
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const home = homedir();

app.setName('Arcadia');
if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let games: Game[] = [];
const userData = app.getPath('userData');
const settings = new SettingsStore(userData);
const cache = new LibraryCache(userData);
const session = new SessionManager();
const helper = new HelperClient(HelperClient.defaultPath(app.isPackaged, appRoot));

function send<C extends EventChannel>(channel: C, payload: IpcEvents[C]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    backgroundColor: '#05060a',
    title: 'Arcadia',
    titleBarStyle: windowed ? 'default' : 'hidden',
    webPreferences: {
      preload: join(appRoot, 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep the frame loop alive even when an emulator covers the window.
      backgroundThrottling: false,
    },
  });

  w.once('ready-to-show', () => {
    // simpleFullScreen is the pre-Lion fullscreen: covers the menu bar and Dock
    // without creating a separate Space, so launching/quitting games doesn't
    // slide between Spaces.
    if (!windowed) {
      if (isMac) w.setSimpleFullScreen(true);
      else w.setFullScreen(true);
    }
    w.show();
  });

  // Nothing in this app navigates or opens windows; block it outright.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void w.loadFile(join(appRoot, 'out', 'renderer', 'index.html'));
  return w;
}

function adapterContext(id: EmulatorId, s: Settings): AdapterContext {
  return { settings: s, managedDir: join(userData, 'emulators', id), home };
}

function switchKeysPath(s: Settings): string {
  return s.switchKeysPath ?? join(s.emulators.ryubing.dataDir ?? defaultRyubingDataDir(home), 'system', 'prod.keys');
}

async function rescan(): Promise<ScanSummary> {
  const s = settings.get();
  const switchHeaderKey = await loadHeaderKey(switchKeysPath(s));
  const summary = await scanLibrary(s.libraryFolders, cache, { switchHeaderKey }, (p) => send('library:progress', p));
  games = sortGames(cache.games());
  return summary;
}

function setQuitShortcut(accelerator: string, enabled: boolean): void {
  globalShortcut.unregisterAll();
  if (!enabled) return;
  try {
    globalShortcut.register(accelerator, () => session.quit());
  } catch (err) {
    console.error(`Invalid quit shortcut ${accelerator}:`, err);
  }
}

const SETTINGS_PANES = {
  bluetooth: 'x-apple.systempreferences:com.apple.BluetoothSettings',
  gameControllers: 'x-apple.systempreferences:com.apple.Game-Controller-Settings.extension',
  privacy: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension',
} as const;

const PatchSchema = z.record(z.string(), z.unknown());
const LaunchSchema = z.object({ gameId: z.string().min(1) });
const PickSchema = z.object({ kind: z.enum(['app', 'folder', 'file']), title: z.string().max(200) });
const RgbSchema = z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) });

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents;
}

function wire(): void {
  session.on('state', (state) => {
    send('session:state', state);
    // Watch the controller system-wide only while a game is running.
    helper.send({ cmd: 'watch', enabled: state.kind === 'running', holdMs: 1000 });
    setQuitShortcut(settings.get().quitShortcut, state.kind === 'running');
    if (state.kind === 'ended' && win) void restoreFocus(win);
  });
  helper.on('status', (s) => send('controller:status', s));
  helper.on('pair', (p) => send('controller:pair', p));
  helper.on('quitGesture', () => session.quit());
  settings.onChange((s, prev) => {
    if (JSON.stringify(s.controller.lightBar) !== JSON.stringify(prev.controller.lightBar)) {
      helper.send({ cmd: 'setLight', ...s.controller.lightBar });
    }
  });

  registerHandlers(
    {
      'settings:get': () => settings.get(),
      'settings:update': async (patch) => {
        const prev = settings.get();
        const next = await settings.update(PatchSchema.parse(patch) as SettingsPatch);
        // New keys can identify Switch dumps that were unidentified before.
        if (switchKeysPath(prev) !== switchKeysPath(next)) cache.replaceAll(new Map());
        return next;
      },
      'library:list': () => games,
      'library:scan': () => rescan(),
      'emulators:status': () => Promise.all(allAdapters().map((a) => a.detect(adapterContext(a.id, settings.get())))),
      'emulators:autodetect': async () => {
        const found: Partial<Record<EmulatorId, string>> = {};
        for (const a of allAdapters()) {
          outer: for (const dir of candidateAppDirs(home)) {
            for (const name of a.bundleNames) {
              const p = join(dir, name);
              if (await exists(p)) {
                found[a.id] = p;
                break outer;
              }
            }
          }
        }
        return found;
      },
      'game:launch': async (req) => {
        const { gameId } = LaunchSchema.parse(req);
        const game = games.find((g) => g.id === gameId);
        // Only paths that came from our own scan can be launched.
        if (!game) return { ok: false, error: 'That game is no longer in the library. Rescan and try again.', warnings: [] };
        const s = settings.get();
        const ctx = adapterContext(game.emulator, s);
        await mkdir(ctx.managedDir, { recursive: true });
        return session.launch(game, getAdapter(game.emulator), ctx, s.controller);
      },
      'session:get': () => session.current,
      'session:quit': () => session.quit(),
      'dialog:pick': async (req) => {
        const { kind, title } = PickSchema.parse(req);
        if (!win) return null;
        const r = await dialog.showOpenDialog(win, {
          title,
          defaultPath: kind === 'app' ? '/Applications' : home,
          // On macOS, .app bundles are files to the picker; treatPackageAsDirectory stays off.
          properties: kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile'],
          ...(kind === 'app' && isMac ? { filters: [{ name: 'Applications', extensions: ['app'] }] } : {}),
        });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      'controller:status': () => helper.status,
      'controller:pair': () => {
        if (!helper.send({ cmd: 'pair', timeoutSec: 60 })) {
          send('controller:pair', { phase: 'failed', message: helper.status.helperMessage ?? 'Pairing helper unavailable.' });
        }
      },
      'controller:cancelPair': () => {
        helper.send({ cmd: 'cancelPair' });
      },
      'controller:setLight': (req) => {
        helper.send({ cmd: 'setLight', ...RgbSchema.parse(req) });
      },
      'system:openSettingsPane': async (pane) => {
        const url = SETTINGS_PANES[z.enum(['bluetooth', 'gameControllers', 'privacy']).parse(pane)];
        if (isMac) await shell.openExternal(url);
      },
      'app:quit': () => app.quit(),
    },
    isTrustedSender,
  );
}

app.on('second-instance', () => {
  if (win) void restoreFocus(win);
});

app.whenReady().then(async () => {
  await settings.load();
  await cache.load();
  games = sortGames(cache.games());
  wire();
  helper.start();
  helper.send({ cmd: 'setLight', ...settings.get().controller.lightBar });
  win = createWindow();
  win.on('closed', () => (win = null));
  // Refresh in the background so the cached library shows instantly.
  if (settings.get().libraryFolders.length) {
    void rescan().then(() => send('library:progress', { phase: 'done', scanned: games.length, total: games.length }));
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  session.dispose();
  helper.stop();
});

app.on('window-all-closed', () => app.quit());

