import type { ArcadiaApi } from '@shared/ipc';

/**
 * The preload bridge. In a plain browser (vite dev without Electron) a mock
 * stands in so the UI can be developed and screenshotted on its own.
 */
export const api: ArcadiaApi =
  window.arcadia ?? (import.meta.env.DEV ? (await import('./dev/mock')).createMockApi() : missingBridge());

function missingBridge(): never {
  throw new Error('Arcadia preload bridge is missing');
}
