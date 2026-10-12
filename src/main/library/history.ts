import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { gameKey } from '@shared/library';
import type { Game, PlayRecord } from '@shared/types';
import { writeFileAtomic } from '../util/fsx';

/** Shorter sessions (crashes, accidental launches) don't count toward history. */
const MIN_SESSION_MS = 15_000;

/** Last played time and total play time per game, in userData/history.json. */
export class PlayHistory {
  private records: Record<string, PlayRecord> = {};
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'history.json');
  }

  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      this.records = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        // Keep only well-formed records; a hand-edited or damaged file can't break saving.
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const r = v as Partial<PlayRecord> | null;
          if (r && typeof r.lastPlayed === 'number' && typeof r.totalMs === 'number' && typeof r.sessions === 'number') {
            this.records[k] = { lastPlayed: r.lastPlayed, totalMs: r.totalMs, sessions: r.sessions };
          }
        }
      }
    } catch {
      this.records = {};
    }
  }

  all(): Record<string, PlayRecord> {
    return this.records;
  }

  private apply(game: Game, playedMs: number, endedAt: number): PlayRecord | null {
    if (playedMs < MIN_SESSION_MS) return null;
    const key = gameKey(game);
    const prev = this.records[key];
    const next: PlayRecord = { lastPlayed: endedAt, totalMs: (prev?.totalMs ?? 0) + playedMs, sessions: (prev?.sessions ?? 0) + 1 };
    this.records[key] = next;
    return next;
  }

  /** Returns the updated record, or null if the session was too short to count. */
  async record(game: Game, playedMs: number, endedAt = Date.now()): Promise<PlayRecord | null> {
    const next = this.apply(game, playedMs, endedAt);
    if (next) await writeFileAtomic(this.file, JSON.stringify(this.records, null, 2));
    return next;
  }

  /**
   * Synchronous variant for app shutdown: async work started in 'will-quit'
   * may never finish, so the session is written before the process exits.
   */
  recordSync(game: Game, playedMs: number, endedAt = Date.now()): void {
    if (!this.apply(game, playedMs, endedAt)) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.quit.tmp`;
    writeFileSync(tmp, JSON.stringify(this.records, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
