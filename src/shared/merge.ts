/** Map-like settings whose keys come and go: a patch replaces them whole. */
const REPLACE_WHOLE = new Set(['layout', 'gameGraphics']);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge for plain objects; arrays, scalars and REPLACE_WHOLE keys replace. */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) && !REPLACE_WHOLE.has(k) ? mergeSettings(out[k], v) : v;
  }
  return out as T;
}
