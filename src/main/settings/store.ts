import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch } from '@shared/settings';
import { isPlainObject, mergeSettings } from '@shared/merge';
import { writeFileAtomic } from '../util/fsx';

/** Settings live in a JSON file under the app's userData folder. */
export class SettingsStore {
  private current: Settings = SettingsSchema.parse({});
  private readonly file: string;
  private listeners = new Set<(s: Settings, prev: Settings) => void>();

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'settings.json');
  }

  async load(): Promise<Settings> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      this.current = SettingsSchema.parse({});
      return this.current;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await this.backUp(text);
      this.current = SettingsSchema.parse({});
      return this.current;
    }
    const parsed = SettingsSchema.safeParse(raw);
    if (parsed.success) {
      this.current = parsed.data;
    } else {
      // One bad value (a hand edit, a newer build's field) must not cost the user
      // their folders and emulator paths: keep every section that still validates.
      await this.backUp(text);
      this.current = salvageSettings(raw);
      // Save the repaired version so the next start doesn't back up the same file again.
      await writeFileAtomic(this.file, JSON.stringify(this.current, null, 2)).catch(() => undefined);
    }
    return this.current;
  }

  /** Keep a copy of a file that couldn't be read cleanly before it gets rewritten. */
  private async backUp(text: string): Promise<void> {
    try {
      await writeFile(`${this.file}.invalid-${Date.now()}.json`, text, 'utf8');
    } catch {
      /* best effort */
    }
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const merged = mergeSettings(this.current, patch);
    const next = SettingsSchema.parse(merged);
    const prev = this.current;
    this.current = next;
    await writeFileAtomic(this.file, JSON.stringify(next, null, 2));
    for (const l of this.listeners) l(next, prev);
    return next;
  }

  onChange(fn: (s: Settings, prev: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * Settings from a file that failed validation. Starting from defaults, every
 * value from the file is tried one at a time (array items one by one) and
 * kept if the settings stay valid, so a single bad field costs only itself.
 */
export function salvageSettings(raw: unknown): Settings {
  let result: Record<string, unknown> = SettingsSchema.parse({}) as Record<string, unknown>;
  const valid = (candidate: Record<string, unknown>): boolean => SettingsSchema.safeParse(candidate).success;

  const tryAt = (path: string[], value: unknown): void => {
    const candidate = setPath(result, path, value);
    if (valid(candidate)) {
      result = candidate;
      return;
    }
    if (Array.isArray(value)) {
      // Keep the good items of a list (e.g. library folders).
      let kept: unknown[] = [];
      for (const item of value) {
        const withItem = setPath(result, path, [...kept, item]);
        if (valid(withItem)) {
          kept = [...kept, item];
          result = withItem;
        }
      }
    } else if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) tryAt([...path, k], v);
    }
  };

  if (isPlainObject(raw)) for (const [k, v] of Object.entries(raw)) tryAt([k], v);
  const parsed = SettingsSchema.safeParse(result);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return obj;
  const child = obj[head];
  return { ...obj, [head]: rest.length ? setPath(isPlainObject(child) ? child : {}, rest, value) : value };
}
