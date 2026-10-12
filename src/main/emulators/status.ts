import type { EmulatorId } from '@shared/platforms';
import { EMULATOR_LABEL } from '@shared/platforms';
import type { EmulatorStatus } from '@shared/types';
import { gatekeeperIssues, resolveApp, type ResolvedApp } from '../platform/macos/bundle';

/** Shared detect() body: resolve the bundle and run Gatekeeper checks. */
export async function detectApp(id: EmulatorId, installPath: string | null): Promise<{ status: EmulatorStatus; app: ResolvedApp | null }> {
  const label = EMULATOR_LABEL[id];
  const status: EmulatorStatus = { id, configured: !!installPath, installPath, executable: null, version: null, arch: [], issues: [] };
  if (!installPath) {
    status.issues.push({ level: 'error', message: `Choose where ${label} is installed.` });
    return { status, app: null };
  }
  try {
    const app = await resolveApp(installPath);
    Object.assign(status, { executable: app.executable, version: app.version, arch: app.arch });
    status.issues.push(...(await gatekeeperIssues(app, label)));
    return { status, app };
  } catch (err) {
    status.issues.push({ level: 'error', message: `Couldn't read ${label} at ${installPath}: ${(err as Error).message}` });
    return { status, app: null };
  }
}
