import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Game, LaunchResult, SessionState } from '@shared/types';
import type { AdapterContext, EmulatorAdapter } from '../emulators/adapter';
import type { ControllerProfile } from '@shared/settings';
import { resolveApp } from '../platform/macos/bundle';
import { childEnv } from '../util/exec';

const STDERR_TAIL_BYTES = 16 * 1024;
const KILL_GRACE_MS = 8000;

/**
 * One game at a time. State machine:
 *   idle → launching → running → (stopping) → ended → idle
 * `ended` is emitted once so the UI can show a crash toast, then returns to idle.
 */
export class SessionManager extends EventEmitter<{ state: [SessionState] }> {
  private state: SessionState = { kind: 'idle' };
  private child: ChildProcess | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  get current(): SessionState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state.kind === 'launching' || this.state.kind === 'running' || this.state.kind === 'stopping';
  }

  private set(next: SessionState): void {
    this.state = next;
    this.emit('state', next);
  }

  async launch(game: Game, adapter: EmulatorAdapter, ctx: AdapterContext, profile: ControllerProfile): Promise<LaunchResult> {
    if (this.isActive) return { ok: false, error: 'A game is already running.', warnings: [] };
    const base = { gameId: game.id, emulator: adapter.id };
    this.set({ kind: 'launching', ...base });

    const fail = (error: string): LaunchResult => {
      this.set({ kind: 'ended', ...base, exitCode: null, signal: null, error, playedMs: 0 });
      this.set({ kind: 'idle' });
      return { ok: false, error, warnings: [] };
    };

    const installPath = adapter.installPath(ctx.settings);
    if (!installPath) return fail(`Set the ${adapter.id} install location in Settings.`);

    let warnings: string[];
    let spec;
    try {
      const status = await adapter.detect(ctx);
      const blocking = status.issues.find((i) => i.level === 'error');
      if (blocking) return fail(blocking.message);
      const appInfo = await resolveApp(installPath);
      ({ warnings } = await adapter.writeConfig(ctx, profile));
      spec = adapter.getLaunchArgs(game, appInfo, ctx);
    } catch (err) {
      return fail((err as Error).message);
    }

    let stderrTail = '';
    const startedAt = Date.now();
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: childEnv(spec.env),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });

    return new Promise<LaunchResult>((resolve) => {
      child.once('spawn', () => {
        this.set({ kind: 'running', ...base, pid: child.pid ?? -1, startedAt });
        resolve({ ok: true, warnings });
      });
      child.once('error', (err) => {
        // ENOENT / EACCES / Gatekeeper refusal surface here, before 'spawn'.
        this.cleanup();
        resolve(fail(`Couldn't start ${adapter.id}: ${err.message}`));
      });
      child.once('exit', (code, signal) => {
        if (this.state.kind !== 'running' && this.state.kind !== 'stopping') return;
        const userStopped = this.state.kind === 'stopping';
        this.cleanup();
        const crashed = !userStopped && code !== 0 && code !== null;
        this.set({
          kind: 'ended',
          ...base,
          exitCode: code,
          signal,
          playedMs: Date.now() - startedAt,
          ...(crashed ? { error: `${adapter.id} exited with code ${code}.`, stderrTail: lastLines(stderrTail, 12) } : {}),
        });
        this.set({ kind: 'idle' });
      });
    });
  }

  /** Ask the emulator to quit (SIGTERM lets it flush saves), then force it. */
  quit(): void {
    if (this.state.kind !== 'running' || !this.child) return;
    const { gameId, emulator } = this.state;
    this.set({ kind: 'stopping', gameId, emulator });
    this.child.kill('SIGTERM');
    this.killTimer = setTimeout(() => this.child?.kill('SIGKILL'), KILL_GRACE_MS);
  }

  /** On app quit: don't leave an orphaned emulator running. */
  dispose(): void {
    this.child?.kill('SIGTERM');
    this.cleanup();
  }

  private cleanup(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
    this.child = null;
  }
}

function lastLines(text: string, n: number): string {
  return text.trimEnd().split('\n').slice(-n).join('\n');
}
