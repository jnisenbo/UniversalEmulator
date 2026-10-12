import type { EmulatorId, Platform } from '@shared/platforms';
import type { ControllerProfile, Settings } from '@shared/settings';
import type { EmulatorStatus, Game } from '@shared/types';
import type { ResolvedApp } from '../platform/macos/bundle';

export interface AdapterContext {
  settings: Settings;
  /** Arcadia-owned folder for this emulator's config (under userData). */
  managedDir: string;
  home: string;
}

export interface LaunchSpec {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ConfigResult {
  /** Non-fatal problems the user should know about (shown after launch). */
  warnings: string[];
}

/**
 * One adapter per emulator. Adding an emulator = adding an adapter and
 * registering it; nothing else in the app knows emulator specifics.
 */
export interface EmulatorAdapter {
  id: EmulatorId;
  platforms: readonly Platform[];
  /** App bundle names used only to suggest install paths. */
  bundleNames: readonly string[];
  installPath(settings: Settings): string | null;
  /** Validates the install. Must not throw; problems go into `issues`. */
  detect(ctx: AdapterContext): Promise<EmulatorStatus>;
  /** Writes Arcadia's managed config. Fatal problems throw with a user-facing message. */
  writeConfig(ctx: AdapterContext, profile: ControllerProfile): Promise<ConfigResult>;
  getLaunchArgs(game: Game, app: ResolvedApp, ctx: AdapterContext): LaunchSpec;
}
