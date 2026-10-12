import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { run } from '../util/exec';

/**
 * The in-game menu: a transparent, always-on-top window that can float over
 * an emulator, including one in native fullscreen (its own Space). It loads
 * the same renderer with #overlay.
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null;

  constructor(private readonly appRoot: string) {}

  get isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  get webContents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  /** Create ahead of time so opening the menu is instant. */
  prepare(): void {
    if (this.win && !this.win.isDestroyed()) return;
    const w = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(this.appRoot, 'out', 'preload', 'index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    // Above fullscreen apps, on every Space.
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#overlay`);
    else void w.loadFile(join(this.appRoot, 'out', 'renderer', 'index.html'), { hash: 'overlay' });
    this.win = w;
  }

  open(): void {
    this.prepare();
    const w = this.win!;
    // Cover the display the user is looking at (where the emulator is).
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    w.setBounds(display.bounds);
    w.show();
    w.focus();
    // Best effort: macOS 14+ may refuse; the helper drives the menu either way.
    app.focus({ steal: true });
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

/** Give focus back to the emulator after Resume. `open` on a running app activates it. */
export async function activateApp(installPath: string | null): Promise<void> {
  if (process.platform !== 'darwin' || !installPath?.endsWith('.app')) return;
  await run('/usr/bin/open', [installPath]);
}
