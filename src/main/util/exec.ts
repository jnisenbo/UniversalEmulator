import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** execFile that never throws; returns the exit code instead. */
export function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Environment for child emulators: drop Electron/Node variables that could change their behavior. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || k === 'NODE_ENV') continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}
