import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { HelperCommand, HelperEvent } from '@shared/helper-protocol';
import type { ControllerStatus, PairEvent } from '@shared/types';

export type MenuButton = Extract<HelperEvent, { event: 'button' }>['button'];

interface Events {
  status: [ControllerStatus];
  pair: [PairEvent];
  home: [source: 'home' | 'chord'];
  button: [MenuButton];
}

const MAX_RESTARTS = 5;

/**
 * Owns the native Swift helper process. If the helper is missing (not built,
 * or not on macOS) everything degrades: no Bluetooth pairing from Arcadia,
 * no in-game Home menu from the controller (⌘⇧Esc still quits). The UI explains the fallback.
 */
export class HelperClient extends EventEmitter<Events> {
  private child: ChildProcess | null = null;
  private restarts = 0;
  private stopped = false;
  private lastStatus: ControllerStatus;
  private pending: HelperCommand[] = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private lastLight: HelperCommand | null = null;
  private lastWatch: HelperCommand | null = null;
  private ready = false;

  constructor(private readonly binaryPath: string) {
    super();
    this.lastStatus =
      process.platform !== 'darwin'
        ? { helper: 'unsupported', helperMessage: 'Controller pairing needs macOS.', controllers: [] }
        : { helper: 'unavailable', helperMessage: 'Native helper not built (run pnpm build:helper).', controllers: [] };
  }

  static defaultPath(isPackaged: boolean, appRoot: string): string {
    return isPackaged ? join(process.resourcesPath, 'bin', 'arcadia-helper') : join(appRoot, 'native', 'build', 'arcadia-helper');
  }

  get status(): ControllerStatus {
    return this.lastStatus;
  }

  start(): void {
    if (process.platform !== 'darwin' || !existsSync(this.binaryPath)) {
      this.emit('status', this.lastStatus);
      return;
    }
    this.stopped = false;
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    // Writing to a helper that just died raises EPIPE here; the 'exit' handler restarts it.
    child.stdin?.on('error', () => undefined);
    createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line));
    child.on('exit', (code) => {
      this.child = null;
      this.ready = false;
      if (this.stopped) return;
      this.setStatus({ helper: 'unavailable', helperMessage: `Helper exited (${code}).`, controllers: [] });
      // Commands queued for the dead process must not replay into a new one.
      // State (light, watch mode) is re-sent on 'ready'; a lost pairing request fails visibly.
      if (this.pending.some((c) => c.cmd === 'pair')) {
        this.emit('pair', { phase: 'failed', message: 'The controller helper restarted. Try pairing again.' });
      }
      this.pending = [];
      if (this.restarts++ < MAX_RESTARTS) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.stopped) this.start();
        }, 1000 * this.restarts);
      }
    });
    child.on('error', (err) => this.setStatus({ helper: 'unavailable', helperMessage: err.message, controllers: [] }));
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.pending = [];
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }

  send(cmd: HelperCommand): boolean {
    // Remember the latest state commands so a restarted helper gets them again.
    if (cmd.cmd === 'setLight') this.lastLight = cmd;
    if (cmd.cmd === 'watch') this.lastWatch = cmd;
    if (!this.child) return false;
    if (!this.ready) {
      this.pending.push(cmd);
      return true;
    }
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    stdin.write(JSON.stringify(cmd) + '\n');
    return true;
  }

  private setStatus(s: ControllerStatus): void {
    this.lastStatus = s;
    this.emit('status', s);
  }

  private onLine(line: string): void {
    let msg: HelperEvent;
    try {
      msg = JSON.parse(line) as HelperEvent;
    } catch {
      return;
    }
    switch (msg.event) {
      case 'ready':
        this.ready = true;
        this.restarts = 0;
        {
          const queued = this.pending.splice(0);
          const state = [this.lastLight, this.lastWatch].filter((c): c is HelperCommand => !!c && !queued.includes(c));
          for (const c of [...state, ...queued]) this.send(c);
        }
        break;
      case 'controllers':
        this.setStatus({ helper: 'running', controllers: msg.controllers });
        break;
      case 'pair':
        this.emit('pair', { phase: msg.phase, ...(msg.name ? { name: msg.name } : {}), ...(msg.message ? { message: msg.message } : {}) });
        break;
      case 'home':
        this.emit('home', msg.source);
        break;
      case 'button':
        this.emit('button', msg.button);
        break;
      case 'log':
        console[msg.level === 'error' ? 'error' : 'log'](`[helper] ${msg.message}`);
        break;
    }
  }
}
