import type {
  ArtSearchResult,
  ControllerStatus,
  GameArt,
  InstallInfo,
  InstallProgress,
  PlayRecord,
  EmulatorStatus,
  Game,
  LaunchResult,
  PairEvent,
  PickKind,
  ScanProgress,
  ScanSummary,
  SessionState,
} from './types';
import type { Settings, SettingsPatch } from './settings';
import type { EmulatorId } from './platforms';

/** Renderer → main request/response channels. */
export interface IpcRequests {
  'settings:get': { req: void; res: Settings };
  'settings:update': { req: SettingsPatch; res: Settings };
  'library:list': { req: void; res: Game[] };
  'library:scan': { req: void; res: ScanSummary };
  'emulators:status': { req: void; res: EmulatorStatus[] };
  'emulators:autodetect': { req: void; res: Partial<Record<EmulatorId, string>> };
  'emulators:installInfo': { req: { checkLatest: boolean }; res: InstallInfo[] };
  'emulators:install': { req: { id: EmulatorId }; res: { ok: boolean; path?: string; error?: string } };
  'emulators:installFromFile': { req: { id: EmulatorId }; res: { ok: boolean; path?: string; error?: string; cancelled?: boolean } };
  'emulators:openApp': { req: { id: EmulatorId }; res: void };
  'emulators:openHomepage': { req: { id: EmulatorId }; res: void };
  'game:launch': { req: { gameId: string }; res: LaunchResult };
  'session:get': { req: void; res: SessionState };
  'session:quit': { req: void; res: void };
  'dialog:pick': { req: { kind: PickKind; title: string }; res: string | null };
  'controller:status': { req: void; res: ControllerStatus };
  'controller:pair': { req: void; res: void };
  'controller:cancelPair': { req: void; res: void };
  'controller:setLight': { req: { r: number; g: number; b: number }; res: void };
  'system:openSettingsPane': { req: 'bluetooth' | 'gameControllers' | 'privacy'; res: void };
  'app:quit': { req: void; res: void };
  'history:all': { req: void; res: Record<string, PlayRecord> };
  'art:all': { req: void; res: Record<string, GameArt> };
  'art:fetchMissing': { req: void; res: void };
  'art:refresh': { req: { gameId: string; sourceId?: number }; res: GameArt | null };
  'art:search': { req: { gameId: string; term?: string }; res: ArtSearchResult[] };
  'game:reveal': { req: { gameId: string }; res: void };
  'saves:backupNow': { req: void; res: { copied: number; bytes: number; errors: string[]; folder: string } };
  'saves:folder': { req: void; res: string };
  'clipboard:readText': { req: void; res: string };
  'overlay:resume': { req: void; res: void };
  'overlay:quitGame': { req: void; res: void };
}

/** Main → renderer push channels. */
export interface IpcEvents {
  'library:progress': ScanProgress;
  'session:state': SessionState;
  'controller:status': ControllerStatus;
  'controller:pair': PairEvent;
  /** Menu navigation forwarded from the helper while the in-game menu is open. */
  'overlay:input': { action: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' };
  'overlay:opened': { gameId: string };
  'art:updated': { gameId: string; art: GameArt | null };
  'emulators:installProgress': InstallProgress;
  'history:updated': { key: string; record: PlayRecord };
}

export type RequestChannel = keyof IpcRequests;
export type EventChannel = keyof IpcEvents;

export const REQUEST_CHANNELS = [
  'settings:get',
  'settings:update',
  'library:list',
  'library:scan',
  'emulators:status',
  'emulators:autodetect',
  'emulators:installInfo',
  'emulators:install',
  'emulators:installFromFile',
  'emulators:openApp',
  'emulators:openHomepage',
  'game:launch',
  'session:get',
  'session:quit',
  'dialog:pick',
  'controller:status',
  'controller:pair',
  'controller:cancelPair',
  'controller:setLight',
  'system:openSettingsPane',
  'app:quit',
  'history:all',
  'art:all',
  'art:fetchMissing',
  'art:refresh',
  'art:search',
  'game:reveal',
  'saves:backupNow',
  'saves:folder',
  'clipboard:readText',
  'overlay:resume',
  'overlay:quitGame',
] as const satisfies readonly RequestChannel[];

export const EVENT_CHANNELS = [
  'library:progress',
  'session:state',
  'controller:status',
  'controller:pair',
  'overlay:input',
  'overlay:opened',
  'art:updated',
  'emulators:installProgress',
  'history:updated',
] as const satisfies readonly EventChannel[];

export interface ArcadiaApi {
  invoke<C extends RequestChannel>(channel: C, ...args: IpcRequests[C]['req'] extends void ? [] : [IpcRequests[C]['req']]): Promise<IpcRequests[C]['res']>;
  on<C extends EventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void;
  platform: string;
}
