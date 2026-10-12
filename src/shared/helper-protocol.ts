/**
 * JSON-lines protocol between the main process and the native Swift helper
 * (native/ArcadiaHelper). One JSON object per line in each direction.
 */
export type HelperCommand =
  | { cmd: 'status' }
  | { cmd: 'pair'; timeoutSec: number }
  | { cmd: 'cancelPair' }
  | { cmd: 'setLight'; r: number; g: number; b: number }
  /** Watch the controller system-wide (even when an emulator is frontmost). */
  | { cmd: 'watch'; enabled: boolean; holdMs: number };

export type HelperEvent =
  | { event: 'ready'; version: string }
  | { event: 'controllers'; controllers: { id: string; name: string; isDualSense: boolean; battery: number | null; charging: boolean | null }[] }
  | { event: 'pair'; phase: 'searching' | 'found' | 'pairing' | 'connected' | 'failed' | 'timeout' | 'cancelled'; name?: string; message?: string }
  /** Home held, or Create + Options held, for holdMs while watching. */
  | { event: 'quitGesture'; source: 'home' | 'chord' }
  | { event: 'log'; level: 'info' | 'warn' | 'error'; message: string };
