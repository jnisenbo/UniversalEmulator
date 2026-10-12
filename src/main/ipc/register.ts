import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcRequests, RequestChannel } from '@shared/ipc';

type Handler<C extends RequestChannel> = (req: IpcRequests[C]['req'], event: IpcMainInvokeEvent) => Promise<IpcRequests[C]['res']> | IpcRequests[C]['res'];
export type Handlers = { [C in RequestChannel]: Handler<C> };

/**
 * Registers every channel from the shared contract. The `Handlers` type
 * forces one handler per channel; inputs are validated inside handlers with zod.
 * Only the app's own page may call in.
 */
export function registerHandlers(handlers: Handlers, isTrustedSender: (e: IpcMainInvokeEvent) => boolean): void {
  for (const channel of Object.keys(handlers) as RequestChannel[]) {
    ipcMain.handle(channel, async (event, req: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender');
      return (handlers[channel] as Handler<typeof channel>)(req as never, event);
    });
  }
}
