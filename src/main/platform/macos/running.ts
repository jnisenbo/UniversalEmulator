import { run } from '../../util/exec';

/** `lsappinfo list` shows every app LaunchServices has registered, each with `bundle path="…"`. */
export async function isRegisteredRunning(installPath: string): Promise<boolean> {
  const r = await run('/usr/bin/lsappinfo', ['list']);
  return r.code === 0 && listsBundle(r.stdout, installPath);
}

export const listsBundle = (lsappinfoList: string, installPath: string): boolean =>
  lsappinfoList.includes(`bundle path="${installPath.replace(/\/+$/, '')}"`);
