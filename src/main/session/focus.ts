import { app, type BrowserWindow } from 'electron';
import { dirname } from 'node:path';
import { run } from '../util/exec';

/** …/Arcadia.app/Contents/MacOS/Arcadia → …/Arcadia.app */
function ownBundlePath(): string | null {
  const macosDir = dirname(process.execPath);
  const bundle = dirname(dirname(macosDir));
  return bundle.endsWith('.app') ? bundle : null;
}

/**
 * Bring Arcadia back after an emulator exits.
 *
 * Since macOS 14 ("cooperative activation") an app can't reliably take focus
 * on its own. Usually macOS activates the next window in line (ours) when the
 * emulator quits; if not, `open <our bundle>` asks LaunchServices to activate
 * the running instance, which is allowed.
 */
export async function restoreFocus(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform !== 'darwin') {
    win.focus();
    return;
  }
  app.focus({ steal: true });
  win.focus();
  // Re-assert presentation: the menu bar and Dock can come back after another app's fullscreen.
  if (!win.isSimpleFullScreen() && !process.env.ARCADIA_WINDOWED) win.setSimpleFullScreen(true);

  await new Promise((r) => setTimeout(r, 300));
  if (!win.isDestroyed() && !win.isFocused()) {
    const bundle = ownBundlePath();
    if (bundle) await run('/usr/bin/open', [bundle]);
  }
}
