import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { HelperCommand, HelperEvent } from '@shared/helper-protocol';
import type { ControllerStatus, PairEvent } from '@shared/types';

interface Events {
  status: [ControllerStatus];
  pair: [PairEvent];
  quitGesture: [source: 'home' | 'chord'];
}

const MAX_RESTARTS = 5;

/**
 * Owns the native Swift helper process. If the helper is missing (not built,
 * or not on macOS) everything degrades: no Bluetooth pairing from Arcadia,
 * no system-wide quit gesture. The UI explains the fallback.
 */
export class HelperClient extends EventEmitter<Events> {
  private child: ChildProcess | null = null;
  private restarts = 0;
  private stopped = false;
  private lastStatus: ControllerStatus;
  private pending: HelperCommand[] = [];
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
    createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line));
    child.on('exit', (code) => {
      this.child = null;
      this.ready = false;
      if (this.stopped) return;
      this.setStatus({ helper: 'unavailable', helperMessage: `Helper exited (${code}).`, controllers: [] });
      if (this.restarts++ < MAX_RESTARTS) setTimeout(() => this.start(), 1000 * this.restarts);
    });
    child.on('error', (err) => this.setStatus({ helper: 'unavailable', helperMessage: err.message, controllers: [] }));
  }

  stop(): void {
    this.stopped = true;
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }

  send(cmd: HelperCommand): boolean {
    if (!this.child) return false;
    if (!this.ready) {
      this.pending.push(cmd);
      return true;
    }
    this.child.stdin?.write(JSON.stringify(cmd) + '\n');
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
        for (const c of this.pending.splice(0)) this.send(c);
        break;
      case 'controllers':
        this.setStatus({ helper: 'running', controllers: msg.controllers });
        break;
      case 'pair':
        this.emit('pair', { phase: msg.phase, ...(msg.name ? { name: msg.name } : {}), ...(msg.message ? { message: msg.message } : {}) });
        break;
      case 'quitGesture':
        this.emit('quitGesture', msg.source);
        break;
      case 'log':
        console[msg.level === 'error' ? 'error' : 'log'](`[helper] ${msg.message}`);
        break;
    }
  }
}
