import { app, BrowserWindow, clipboard, dialog, globalShortcut, net, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { EventChannel, IpcEvents } from '@shared/ipc';
import { EMULATOR_IDS, type EmulatorId, type RunnerId } from '@shared/platforms';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { EmulatorStatus, Game, GameArt, InstallInfo, ScanSummary } from '@shared/types';
import { ART_SCHEME, ArtStore } from './art/store';
import { SteamGridDbClient, type Fetch } from './art/steamgriddb';
import { appIconProvider, freeCoverProvider, steamGridDbProvider, type ArtProvider } from './art/providers';
import { HelperClient, type MenuButton } from './controller/helper';
import type { AdapterContext, EmulatorAdapter } from './emulators/adapter';
import { customAdapter } from './emulators/custom';
import { nativeAdapter } from './emulators/native';
import { findSteamGames } from './library/steam';
import { backupFolder, backupSaves, saveSources, type BackupResult } from './saves/backup';
import { allAdapters, getAdapter } from './emulators/registry';
import { defaultRyubingDataDir } from './emulators/ryubing/adapter';
import { CATALOG } from './install/catalog';
import { Installer, type StreamFetch } from './install/installer';
import type { JsonFetch } from './install/resolve';
import { registerHandlers } from './ipc/register';
import { LibraryCache } from './library/cache';
import { PlayHistory } from './library/history';
import { gameKey } from '@shared/library';
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
// A second launch hands over to the running instance ('second-instance') and exits
// before doing anything else.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.exit(0);

// Must happen before 'ready': lets the renderer load cached artwork.
protocol.registerSchemesAsPrivileged([{ scheme: ART_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win: BrowserWindow | null = null;
let games: Game[] = [];
const userData = app.getPath('userData');
const settings = new SettingsStore(userData);
const cache = new LibraryCache(userData);
const art = new ArtStore(userData);
const history = new PlayHistory(userData);
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

function adapterContext(id: RunnerId, s: Settings): AdapterContext {
  return { settings: s, managedDir: join(userData, 'emulators', id), home, controllers: helper.status.controllers };
}

/** The console's chosen emulator: a custom app if you picked one, else the built-in adapter. */
let currentAdapter: EmulatorAdapter | null = null;
function adapterFor(game: Game, s: Settings): EmulatorAdapter {
  if (game.emulator === 'native') return nativeAdapter(game);
  const custom = s.customEmulators[game.platform];
  return custom ? customAdapter(game.platform, custom) : getAdapter(game.emulator);
}

/**
 * Installed emulators: known app names first, then any app whose name matches
 * (e.g. "Xenia-edge.app", "PCSX2-v2.4.app") in /Applications, ~/Applications, ~/Downloads.
 */
async function findInstalledEmulators(): Promise<Partial<Record<EmulatorId, string>>> {
  const found: Partial<Record<EmulatorId, string>> = {};
  const listings = new Map<string, string[]>();
  for (const dir of candidateAppDirs(home)) listings.set(dir, await readdir(dir).catch(() => [] as string[]));
  for (const a of allAdapters()) {
    const id = a.id as EmulatorId;
    outer: for (const dir of candidateAppDirs(home)) {
      for (const name of a.bundleNames) {
        if (await exists(join(dir, name))) {
          found[id] = join(dir, name);
          break outer;
        }
      }
    }
    if (found[id]) continue;
    for (const dir of candidateAppDirs(home)) {
      const name = listings.get(dir)?.find((n) => CATALOG[id].appName.test(n));
      if (name) {
        found[id] = join(dir, name);
        break;
      }
    }
  }
  return found;
}

/** On startup, fill in emulators that aren't set or whose saved app is gone. Never replaces a working choice. */
async function autoConfigureEmulators(): Promise<void> {
  const s = settings.get();
  const found = await findInstalledEmulators();
  const patch: Record<string, { appPath: string }> = {};
  for (const id of EMULATOR_IDS) {
    const current = s.emulators[id].appPath;
    if (found[id] && (!current || !(await exists(current)))) patch[id] = { appPath: found[id]! };
  }
  if (Object.keys(patch).length) {
    await settings.update({ emulators: patch } as SettingsPatch);
    invalidateStatus();
  }
}

let backupQueue: Promise<unknown> = Promise.resolve();
/** Copy saves to the backup folder: one emulator's after a game, or all of them. Runs one after another. */
function backUpSaves(only?: RunnerId): Promise<BackupResult> {
  const run = backupQueue.catch(() => undefined).then(async () => {
    const s = settings.get();
    const sources = saveSources(s, home).filter((x) => !only || x.emulator === only);
    const result = await backupSaves(sources, await backupFolder(s, home));
    if (result.errors.length) console.error('[saves]', result.errors.slice(0, 5).join('\n'));
    return result;
  });
  backupQueue = run;
  return run;
}

/**
 * macOS doesn't always bring a newly started app to the front when another
 * app launched it. If Arcadia still has focus shortly after the game starts,
 * hand focus to the emulator so its window isn't hidden behind the launcher.
 */
function bringEmulatorForward(): void {
  // Some emulators (Ryujinx-based ones like Astris) take a few seconds to open a
  // window, so check a few times. activateApp never starts a second copy.
  for (const delay of [1500, 4000, 8000]) {
    setTimeout(() => {
      if (session.current.kind !== 'running' || !currentAdapter || !win || win.isDestroyed() || !win.isFocused()) return;
      void activateApp(currentAdapter.installPath(settings.get()));
    }, delay);
  }
}

function switchKeysPath(s: Settings): string {
  return s.switchKeysPath ?? join(s.emulators.ryubing.dataDir ?? defaultRyubingDataDir(home), 'system', 'prod.keys');
}

async function scanOnce(): Promise<ScanSummary> {
  const s = settings.get();
  const switchHeaderKey = await loadHeaderKey(switchKeysPath(s));
  const steamGames = s.steamImport ? await findSteamGames(home).catch((err: unknown) => (console.error('[steam]', err), [])) : [];
  const summary = await scanLibrary(
    s.libraryFolders,
    cache,
    { switchHeaderKey, explicitApps: new Set(s.macGames), steamGames: new Map(steamGames.map((g) => [g.appPath, g])) },
    (p) => send('library:progress', p),
  );
  games = sortGames(cache.games());
  void fetchMissingArt();
  return summary;
}

let scanning: Promise<ScanSummary> | null = null;
let scanAgain = false;
/**
 * One scan at a time. A request during a scan joins it and triggers one more
 * pass afterwards, so changes made meanwhile (a new folder, new keys) are seen.
 */
function rescan(): Promise<ScanSummary> {
  if (scanning) {
    scanAgain = true;
    return scanning;
  }
  scanning = (async () => {
    try {
      let summary: ScanSummary;
      do {
        scanAgain = false;
        summary = await scanOnce();
      } while (scanAgain);
      return summary;
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

// Emulator checks run plutil, lipo, xattr and spctl; cache them briefly.
let statusCache: { at: number; value: Promise<EmulatorStatus[]> } | null = null;
const STATUS_TTL_MS = 30_000;
function invalidateStatus(): void {
  statusCache = null;
}
function emulatorStatuses(): Promise<EmulatorStatus[]> {
  if (!statusCache || Date.now() - statusCache.at > STATUS_TTL_MS) {
    const value = Promise.all(allAdapters().map((a) => a.detect(adapterContext(a.id, settings.get()))));
    statusCache = { at: Date.now(), value };
    value.catch(() => invalidateStatus());
  }
  return statusCache.value;
}

// ---------- Artwork ----------

function artClient(): SteamGridDbClient | null {
  const key = settings.get().metadata.steamGridDbKey;
  return key ? new SteamGridDbClient(key, net.fetch as unknown as Fetch) : null;
}

const freeCovers = freeCoverProvider(net.fetch as unknown as Fetch);
const appIcons = appIconProvider(join(userData, 'art', '.icons'));

/** SteamGridDB first when you've added a key (covers, backgrounds, logos), then free box art. */
function artProviders(): ArtProvider[] {
  const client = artClient();
  return [...(client ? [steamGridDbProvider(client)] : []), freeCovers, appIcons];
}

let artRunning = false;
/** Background, one game at a time, politely spaced. Skips games that already have art. */
async function fetchMissingArt(force = false): Promise<void> {
  if ((!force && !settings.get().metadata.autoFetch) || artRunning) return;
  const providers = artProviders();
  artRunning = true;
  try {
    for (const g of games.filter((x) => art.needsFetch(x))) {
      try {
        const result = await art.fetch(g, providers);
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
  if (current.kind !== 'running') return;
  const adapter = currentAdapter ?? (current.emulator === 'native' ? null : getAdapter(current.emulator));
  if (adapter) await activateApp(adapter.installPath(settings.get()));
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
    if (state.kind === 'running') bringEmulatorForward();
    if (state.kind === 'ended') {
      const game = games.find((g) => g.id === state.gameId);
      if (game) {
        history
          .record(game, state.playedMs)
          .then((record) => record && send('history:updated', { key: gameKey(game), record }))
          .catch((err: unknown) => console.error('[history] could not save play time:', err));
      }
      overlay.close();
      if (win) void restoreFocus(win);
      if (settings.get().saves.backup && state.emulator !== 'native') void backUpSaves(state.emulator);
      // Emulators set their own light bar color during a game; put yours back.
      helper.send({ cmd: 'setLight', ...settings.get().controller.lightBar });
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
        invalidateStatus();
        // New keys can identify Switch dumps that weren't before (cache entries record the key used).
        const macGamesChanged = JSON.stringify(prev.macGames) !== JSON.stringify(next.macGames) || prev.steamImport !== next.steamImport;
        if (switchKeysPath(prev) !== switchKeysPath(next) || macGamesChanged) void rescan().catch((err: unknown) => console.error('[scan]', err));
        return next;
      },
      'library:list': () => games,
      'library:scan': () => rescan(),
      'emulators:status': () => emulatorStatuses(),
      'emulators:autodetect': () => findInstalledEmulators(),
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
          invalidateStatus();
          return { ok: true, path };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
      'emulators:installFromFile': async (req) => {
        const { id } = EmulatorIdSchema.parse(req);
        if (!win) return { ok: false, error: 'No window' };
        const pick = await dialog.showOpenDialog(win, {
          title: `Choose the ${id} download`,
          defaultPath: join(home, 'Downloads'),
          properties: ['openFile'],
          filters: [{ name: 'Downloads', extensions: ['dmg', 'zip', 'gz', 'tgz', 'app'] }],
        });
        const file = pick.filePaths[0];
        if (pick.canceled || !file) return { ok: false, cancelled: true };
        try {
          const path = await installer.installFromFile(id, file, (p) => send('emulators:installProgress', p));
          await settings.update({ emulators: { [id]: { appPath: path } } } as SettingsPatch);
          invalidateStatus();
          return { ok: true, path };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
      'emulators:openApp': async (req) => {
        const { id } = EmulatorIdSchema.parse(req);
        const path = getAdapter(id).installPath(settings.get());
        if (!path) throw new Error('Install or choose the emulator first.');
        // The user is about to fix things inside the emulator (keys, BIOS, first launch).
        invalidateStatus();
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
        const base = settings.get();
        // Per-game graphics override the global ones for this launch only.
        const s = { ...base, graphics: { ...base.graphics, ...base.gameGraphics[gameKey(game)] } };
        const ctx = adapterContext(game.emulator, s);
        await mkdir(ctx.managedDir, { recursive: true });
        overlay.prepare();
        currentAdapter = adapterFor(game, s);
        return session.launch(game, currentAdapter, ctx, s.controller);
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
      'history:all': () => history.all(),
      'art:fetchMissing': () => {
        void fetchMissingArt(true);
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
        if (sourceId !== undefined && !artClient()) throw new Error('Add your SteamGridDB API key in Settings → Artwork.');
        const g = findGame(gameId);
        const result = await art.fetch(g, artProviders(), sourceId);
        sendArtForAllCopies(g, result);
        return result;
      },
      'art:search': async (req) => {
        const { gameId, term } = SearchSchema.parse(req);
        const client = artClient();
        if (!client) throw new Error('Add your SteamGridDB API key in Settings → Artwork.');
        return client.search(term || findGame(gameId).displayTitle);
      },
      'saves:backupNow': () => backUpSaves(),
      'saves:folder': async () => backupFolder(settings.get(), home),
      // For the on-screen keyboard's Paste key (e.g. an API key copied on your phone via Universal Clipboard).
      'clipboard:readText': async () => String(await clipboard.readText()).slice(0, 2000),
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
  if (!isPrimaryInstance) return;
  protocol.handle(ART_SCHEME, (req) => {
    const file = art.filePath(req.url);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });
  await settings.load();
  await Promise.all([cache.load(), art.load(), installer.load(), history.load()]);
  await autoConfigureEmulators().catch((err: unknown) => console.error('[emulators] auto-detect failed:', err));
  games = sortGames(cache.games());
  wire();
  helper.start();
  helper.send({ cmd: 'setLight', ...settings.get().controller.lightBar });
  win = createWindow();
  // Arcadia is one window: closing it quits (the hidden in-game menu window
  // would otherwise keep a windowless app alive).
  // Coming back from another app (e.g. after setting up an emulator): re-check.
  win.on('focus', invalidateStatus);
  win.on('closed', () => {
    win = null;
    app.quit();
  });
  // Refresh in the background so the cached library shows instantly.
  if (settings.get().libraryFolders.length) {
    void rescan().catch((err: unknown) => console.error('[scan]', err));
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Quitting Arcadia mid-game still counts the session toward play history.
  const current = session.current;
  if (current.kind === 'running' || current.kind === 'stopping') {
    const game = games.find((g) => g.id === current.gameId);
    const { startedAt } = current;
    if (game) {
      try {
        history.recordSync(game, Date.now() - startedAt);
      } catch (err) {
        console.error('[history] could not save play time on quit:', err);
      }
    }
  }
  session.dispose();
  helper.stop();
  overlay.destroy();
});

app.on('window-all-closed', () => app.quit());
