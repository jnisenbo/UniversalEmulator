import { app, BrowserWindow, dialog, globalShortcut, net, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { EventChannel, IpcEvents } from '@shared/ipc';
import { EMULATOR_IDS, type EmulatorId } from '@shared/platforms';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { Game, GameArt, InstallInfo, ScanSummary } from '@shared/types';
import { ART_SCHEME, ArtStore } from './art/store';
import { SteamGridDbClient, type Fetch } from './art/steamgriddb';
import { HelperClient, type MenuButton } from './controller/helper';
import type { AdapterContext } from './emulators/adapter';
import { allAdapters, getAdapter } from './emulators/registry';
import { defaultRyubingDataDir } from './emulators/ryubing/adapter';
import { CATALOG } from './install/catalog';
import { Installer, type StreamFetch } from './install/installer';
import type { JsonFetch } from './install/resolve';
import { registerHandlers } from './ipc/register';
import { LibraryCache } from './library/cache';
import { loadHeaderKey } from './library/probes/switch-keys';
import { scanLibrary, sortGames } from './library/scanner';
import { candidateAppDirs } from './platform/macos/bundle';
import { restoreFocus } from './session/focus';
import { activateApp, OverlayWindow } from './session/overlay';
import { SessionManager } from './session/session';
import { SettingsStore } from './settings/store';
import { exists } from './util/fsx';

const isMac = process.platform === 'darwin';
const windowed = !!process.env.ARCADIA_WINDOWED;
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const home = homedir();

app.setName('Arcadia');
if (!app.requestSingleInstanceLock()) app.quit();

// Must happen before 'ready': lets the renderer load cached artwork.
protocol.registerSchemesAsPrivileged([{ scheme: ART_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win: BrowserWindow | null = null;
let games: Game[] = [];
const userData = app.getPath('userData');
const settings = new SettingsStore(userData);
const cache = new LibraryCache(userData);
const art = new ArtStore(userData);
const session = new SessionManager();
const overlay = new OverlayWindow(appRoot);
const helper = new HelperClient(HelperClient.defaultPath(app.isPackaged, appRoot));
// Emulators go to ~/Applications: no admin password needed.
const installer = new Installer(userData, join(home, 'Applications'), net.fetch as unknown as JsonFetch, net.fetch as unknown as StreamFetch);

/** Push an event to the main window and the in-game menu. */
function send<C extends EventChannel>(channel: C, payload: IpcEvents[C]): void {
  for (const wc of [win && !win.isDestroyed() ? win.webContents : null, overlay.webContents]) wc?.send(channel, payload);
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
  void fetchMissingArt();
  return summary;
}

// ---------- Artwork ----------

function artClient(): SteamGridDbClient | null {
  const key = settings.get().metadata.steamGridDbKey;
  return key ? new SteamGridDbClient(key, net.fetch as unknown as Fetch) : null;
}

let artRunning = false;
/** Background, one game at a time, politely spaced. Skips games that already have art. */
async function fetchMissingArt(): Promise<void> {
  const client = artClient();
  if (!client || !settings.get().metadata.autoFetch || artRunning) return;
  artRunning = true;
  try {
    for (const g of games.filter((x) => art.needsFetch(x))) {
      try {
        const result = await art.fetch(g, client);
        sendArtForAllCopies(g, result);
      } catch (err) {
        console.error(`[art] ${g.displayTitle}:`, (err as Error).message);
        if ((err as Error).message.includes('API key')) break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    artRunning = false;
  }
}

/** Several dumps can share art (same platform + game ID); update every tile. */
function sendArtForAllCopies(g: Game, result: GameArt | null): void {
  for (const other of games) if (other.platform === g.platform && (other.gameId ?? other.id) === (g.gameId ?? g.id)) send('art:updated', { gameId: other.id, art: result });
}

// ---------- In-game menu ----------

function openOverlay(): void {
  if (session.current.kind !== 'running') return;
  overlay.open();
  helper.send({ cmd: 'watch', enabled: true, mode: 'menu' });
  send('overlay:opened', { gameId: session.current.gameId });
}

function closeOverlay(): void {
  overlay.close();
  helper.send({ cmd: 'watch', enabled: session.current.kind === 'running', mode: 'game' });
}

/** Close the menu and hand focus back to the emulator. */
async function resumeGame(): Promise<void> {
  closeOverlay();
  const current = session.current;
  if (current.kind === 'running') await activateApp(getAdapter(current.emulator).installPath(settings.get()));
}

/**
 * Hide the launcher while a game runs. Activating Arcadia for the in-game menu
 * would otherwise raise this window over the game (macOS brings all of an
 * app's windows forward). The delay lets the launch transition finish.
 */
let hideTimer: NodeJS.Timeout | null = null;
function hideLauncherDuringGame(running: boolean): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (!running || !win || process.env.ARCADIA_KEEP_VISIBLE) return;
  hideTimer = setTimeout(() => {
    if (session.current.kind === 'running' && win && !win.isDestroyed()) win.hide();
  }, 2000);
}

const MENU_ACTIONS: Record<MenuButton, IpcEvents['overlay:input']['action']> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  south: 'confirm',
  east: 'back',
};

// ---------- IPC ----------

const PatchSchema = z.record(z.string(), z.unknown());
const GameIdSchema = z.object({ gameId: z.string().min(1) });
const RefreshSchema = z.object({ gameId: z.string().min(1), sourceId: z.number().int().positive().optional() });
const SearchSchema = z.object({ gameId: z.string().min(1), term: z.string().max(200).optional() });
const PickSchema = z.object({ kind: z.enum(['app', 'folder', 'file']), title: z.string().max(200) });
const EmulatorIdSchema = z.object({ id: z.enum(EMULATOR_IDS) });
const RgbSchema = z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) });

const SETTINGS_PANES = {
  bluetooth: 'x-apple.systempreferences:com.apple.BluetoothSettings',
  gameControllers: 'x-apple.systempreferences:com.apple.Game-Controller-Settings.extension',
  privacy: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension',
} as const;

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  return (!!win && e.sender === win.webContents) || e.sender === overlay.webContents;
}

function findGame(gameId: string): Game {
  const g = games.find((x) => x.id === gameId);
  if (!g) throw new Error('That game is no longer in the library.');
  return g;
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

function wire(): void {
  session.on('state', (state) => {
    send('session:state', state);
    // Watch the controller system-wide only while a game is running.
    helper.send({ cmd: 'watch', enabled: state.kind === 'running', mode: 'game' });
    setQuitShortcut(settings.get().quitShortcut, state.kind === 'running');
    hideLauncherDuringGame(state.kind === 'running');
    if (state.kind === 'ended') {
      overlay.close();
      if (win) void restoreFocus(win);
    }
  });
  helper.on('status', (s) => send('controller:status', s));
  helper.on('pair', (p) => send('controller:pair', p));
  helper.on('home', () => (overlay.isOpen ? void resumeGame() : openOverlay()));
  helper.on('button', (b) => {
    if (overlay.isOpen) send('overlay:input', { action: MENU_ACTIONS[b] });
  });
  settings.onChange((s, prev) => {
    if (JSON.stringify(s.controller.lightBar) !== JSON.stringify(prev.controller.lightBar)) {
      helper.send({ cmd: 'setLight', ...s.controller.lightBar });
    }
    if (s.metadata.steamGridDbKey !== prev.metadata.steamGridDbKey) void fetchMissingArt();
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
      'emulators:installInfo': async (req) => {
        const check = z.object({ checkLatest: z.boolean() }).parse(req).checkLatest;
        return Promise.all(
          EMULATOR_IDS.map(async (id): Promise<InstallInfo> => {
            const entry = CATALOG[id];
            const info: InstallInfo = {
              id,
              installable: !entry.manualOnly && isMac,
              homepage: entry.homepage,
              managedVersion: installer.managedInstall(id)?.version ?? null,
              latestVersion: null,
              ...(entry.firstRun ? { firstRun: entry.firstRun } : {}),
            };
            if (check && info.installable) {
              try {
                info.latestVersion = (await installer.latest(id)).version;
              } catch (err) {
                info.latestError = (err as Error).message;
              }
            }
            return info;
          }),
        );
      },
      'emulators:install': async (req) => {
        const { id } = EmulatorIdSchema.parse(req);
        try {
          const path = await installer.install(id, (p) => send('emulators:installProgress', p));
          await settings.update({ emulators: { [id]: { appPath: path } } } as SettingsPatch);
          return { ok: true, path };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
      'emulators:openApp': async (req) => {
        const { id } = EmulatorIdSchema.parse(req);
        const path = getAdapter(id).installPath(settings.get());
        if (!path) throw new Error('Install or choose the emulator first.');
        const err = await shell.openPath(path);
        if (err) throw new Error(err);
      },
      'emulators:openHomepage': async (req) => {
        await shell.openExternal(CATALOG[EmulatorIdSchema.parse(req).id].homepage);
      },
      'game:launch': async (req) => {
        const { gameId } = GameIdSchema.parse(req);
        const game = games.find((g) => g.id === gameId);
        // Only paths that came from our own scan can be launched.
        if (!game) return { ok: false, error: 'That game is no longer in the library. Rescan and try again.', warnings: [] };
        const s = settings.get();
        const ctx = adapterContext(game.emulator, s);
        await mkdir(ctx.managedDir, { recursive: true });
        overlay.prepare();
        return session.launch(game, getAdapter(game.emulator), ctx, s.controller);
      },
      'game:reveal': (req) => {
        shell.showItemInFolder(findGame(GameIdSchema.parse(req).gameId).path);
      },
      'session:get': () => session.current,
      'session:quit': () => session.quit(),
      'dialog:pick': async (req) => {
        const { kind, title } = PickSchema.parse(req);
        if (!win) return null;
        const r = await dialog.showOpenDialog(win, {
          title,
          defaultPath: kind === 'app' ? '/Applications' : home,
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
      'art:all': () => {
        const out: Record<string, GameArt> = {};
        for (const g of games) {
          const a = art.artFor(g);
          if (a) out[g.id] = a;
        }
        return out;
      },
      'art:refresh': async (req) => {
        const { gameId, sourceId } = RefreshSchema.parse(req);
        const client = artClient();
        if (!client) throw new Error('Add your SteamGridDB API key in Settings → Artwork.');
        const g = findGame(gameId);
        const result = await art.fetch(g, client, sourceId);
        sendArtForAllCopies(g, result);
        return result;
      },
      'art:search': async (req) => {
        const { gameId, term } = SearchSchema.parse(req);
        const client = artClient();
        if (!client) throw new Error('Add your SteamGridDB API key in Settings → Artwork.');
        return client.search(term || findGame(gameId).displayTitle);
      },
      'overlay:resume': () => resumeGame(),
      'overlay:quitGame': () => {
        closeOverlay();
        session.quit();
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
  protocol.handle(ART_SCHEME, (req) => {
    const file = art.filePath(req.url);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });
  await settings.load();
  await Promise.all([cache.load(), art.load(), installer.load()]);
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
  overlay.destroy();
});

app.on('window-all-closed', () => app.quit());
