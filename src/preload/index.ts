import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, REQUEST_CHANNELS, type ArcadiaApi, type EventChannel, type RequestChannel } from '@shared/ipc';

const requests = new Set<string>(REQUEST_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

/** The whole renderer-facing surface. No raw ipcRenderer is exposed. */
const api: ArcadiaApi = {
  invoke(channel: RequestChannel, ...args: unknown[]) {
    if (!requests.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, args[0]);
  },
  on(channel: EventChannel, listener: (payload: unknown) => void) {
    if (!events.has(channel)) throw new Error(`Unknown event ${channel}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
} as ArcadiaApi;

contextBridge.exposeInMainWorld('arcadia', api);
