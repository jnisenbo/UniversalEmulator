/**
 * JSON-lines protocol between the main process and the native Swift helper
 * (native/ArcadiaHelper). One JSON object per line in each direction.
 */
export type HelperCommand =
  | { cmd: 'status' }
  | { cmd: 'pair'; timeoutSec: number }
  | { cmd: 'cancelPair' }
  | { cmd: 'setLight'; r: number; g: number; b: number }
  /**
   * Watch the controller system-wide (even when an emulator is frontmost).
   * game: report Home presses. menu: also report menu navigation buttons.
   */
  | { cmd: 'watch'; enabled: boolean; mode: 'game' | 'menu' };

export type HelperEvent =
  | { event: 'ready'; version: string }
  | { event: 'controllers'; controllers: { id: string; name: string; isDualSense: boolean; battery: number | null; charging: boolean | null }[] }
  | { event: 'pair'; phase: 'searching' | 'found' | 'pairing' | 'connected' | 'failed' | 'timeout' | 'cancelled'; name?: string; message?: string }
  /** Home pressed, or Create + Options held, while watching. */
  | { event: 'home'; source: 'home' | 'chord' }
  /** Menu navigation while in menu mode. */
  | { event: 'button'; button: 'up' | 'down' | 'left' | 'right' | 'south' | 'east' }
  | { event: 'log'; level: 'info' | 'warn' | 'error'; message: string };
