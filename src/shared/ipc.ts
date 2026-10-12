import type {
  ControllerStatus,
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
}

/** Main → renderer push channels. */
export interface IpcEvents {
  'library:progress': ScanProgress;
  'session:state': SessionState;
  'controller:status': ControllerStatus;
  'controller:pair': PairEvent;
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
] as const satisfies readonly RequestChannel[];

export const EVENT_CHANNELS = [
  'library:progress',
  'session:state',
  'controller:status',
  'controller:pair',
] as const satisfies readonly EventChannel[];

export interface ArcadiaApi {
  invoke<C extends RequestChannel>(channel: C, ...args: IpcRequests[C]['req'] extends void ? [] : [IpcRequests[C]['req']]): Promise<IpcRequests[C]['res']>;
  on<C extends EventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void;
  platform: string;
}
