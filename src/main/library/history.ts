import { readFile } from 'node:fs/promises';
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
      this.records = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, PlayRecord>;
    } catch {
      this.records = {};
    }
  }

  all(): Record<string, PlayRecord> {
    return this.records;
  }

  /** Returns the updated record, or null if the session was too short to count. */
  async record(game: Game, playedMs: number, endedAt = Date.now()): Promise<PlayRecord | null> {
    if (playedMs < MIN_SESSION_MS) return null;
    const key = gameKey(game);
    const prev = this.records[key];
    const next: PlayRecord = { lastPlayed: endedAt, totalMs: (prev?.totalMs ?? 0) + playedMs, sessions: (prev?.sessions ?? 0) + 1 };
    this.records[key] = next;
    await writeFileAtomic(this.file, JSON.stringify(this.records, null, 2));
    return next;
  }
}
