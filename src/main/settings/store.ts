import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch } from '@shared/settings';
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
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      const parsed = SettingsSchema.safeParse(raw);
      // A corrupt or outdated file falls back to defaults rather than blocking startup.
      this.current = parsed.success ? parsed.data : SettingsSchema.parse({});
    } catch {
      this.current = SettingsSchema.parse({});
    }
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const merged = mergeOneLevel(this.current, patch);
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Map-like settings whose keys come and go: a patch replaces them whole. */
const REPLACE_WHOLE = new Set(['layout']);

/** Deep merge for plain objects; arrays, scalars and REPLACE_WHOLE keys replace. */
export function mergeOneLevel<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) && !REPLACE_WHOLE.has(k) ? mergeOneLevel(out[k], v) : v;
  }
  return out as T;
}
