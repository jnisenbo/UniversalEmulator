import type { EmulatorId, Platform } from './platforms';
import type { Settings } from './settings';

export type DiscFormat = 'iso' | 'rvz' | 'wia' | 'wbfs' | 'gcz' | 'nsp' | 'xci' | 'xiso' | 'xex' | 'stfs' | 'chd' | 'cso' | 'cue' | 'folder' | 'rom';

/** Cached artwork for a game, as URLs the renderer can load (arcadia-art://…). */
export interface GameArt {
  grid?: string;
  hero?: string;
  logo?: string;
  /** SteamGridDB game the art came from. */
  sourceId?: number;
  sourceName?: string;
  /** Portrait box art: shown whole on tiles instead of cropped to fill. */
  boxArt?: boolean;
}

export interface ArtSearchResult {
  id: number;
  name: string;
  year: number | null;
}

/** What a probe learned from a file's own bytes. */
export interface GameIdentity {
  platform: Platform;
  format: DiscFormat;
  /** Platform-native ID: 6-char disc ID (GC/Wii), 16-hex title ID (Switch), 8-hex title ID (360). */
  gameId: string | null;
  /** Title from the file's header when the format carries one. */
  title: string | null;
  discNumber: number;
  /** False when the format matched but the ID couldn't be read. */
  identified: boolean;
  /** Something the user should know before launching (e.g. needs conversion). */
  note?: string;
  /** Switch only: base game, update or DLC. Only base games are listed. */
  contentKind?: 'base' | 'update' | 'dlc';
}

export interface Game extends GameIdentity {
  /** Stable ID derived from the path. */
  id: string;
  path: string;
  fileName: string;
  /** Display title: header title, else a cleaned-up filename. */
  displayTitle: string;
  sizeBytes: number;
  emulator: EmulatorId;
  /**
   * Multi-disc games are one entry: every disc's path in disc order (this
   * entry's own path is disc 1). Absent for single-disc games.
   */
  discPaths?: string[];
}

export interface PlayRecord {
  lastPlayed: number;
  totalMs: number;
  sessions: number;
}

export interface ScanProgress {
  phase: 'walking' | 'probing' | 'done';
  scanned: number;
  total: number;
  current?: string;
}

export interface ScanSummary {
  games: number;
  added: number;
  removed: number;
  unidentified: number;
  errors: string[];
}

export type IssueLevel = 'ok' | 'warn' | 'error';
export interface Issue {
  level: IssueLevel;
  message: string;
  /** Optional fix the UI can offer. */
  fix?: 'openPrivacySettings' | 'revealInFinder' | 'openEmulator';
}

export interface EmulatorStatus {
  id: EmulatorId;
  configured: boolean;
  installPath: string | null;
  executable: string | null;
  version: string | null;
  arch: string[];
  issues: Issue[];
}

export type SessionState =
  | { kind: 'idle' }
  | { kind: 'launching'; gameId: string; emulator: EmulatorId }
  | { kind: 'running'; gameId: string; emulator: EmulatorId; pid: number; startedAt: number }
  | { kind: 'stopping'; gameId: string; emulator: EmulatorId; startedAt: number }
  | { kind: 'ended'; gameId: string; emulator: EmulatorId; exitCode: number | null; signal: string | null; error?: string; stderrTail?: string; playedMs: number };

export interface LaunchResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

export interface ControllerInfo {
  id: string;
  name: string;
  isDualSense: boolean;
  /** 0..1, null if unknown. */
  battery: number | null;
  charging: boolean | null;
}

export interface ControllerStatus {
  helper: 'running' | 'unavailable' | 'unsupported';
  helperMessage?: string;
  controllers: ControllerInfo[];
}

export type PairPhase = 'searching' | 'found' | 'pairing' | 'connected' | 'failed' | 'timeout' | 'cancelled';
export interface PairEvent {
  phase: PairPhase;
  name?: string;
  message?: string;
}

export type PickKind = 'app' | 'folder' | 'file';

export interface InstallProgress {
  id: import('./platforms').EmulatorId;
  phase: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'installing' | 'done' | 'error';
  received?: number;
  total?: number | null;
  version?: string;
  message?: string;
}

export interface InstallInfo {
  id: import('./platforms').EmulatorId;
  /** Arcadia can download it. */
  installable: boolean;
  homepage: string;
  /** Installed by Arcadia (in ~/Applications), with its version. */
  managedVersion: string | null;
  /** Newest version available, if it could be checked. */
  latestVersion: string | null;
  latestError?: string;
  firstRun?: string;
}

export type { Settings };
