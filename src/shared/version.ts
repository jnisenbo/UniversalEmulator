/** Numeric comparison of the version parts ("2609a" → [2609], "1.3.3 (Canary)" → [1,3,3]). */
export function isNewer(latest: string, installed: string): boolean {
  const parts = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);
  const a = parts(latest);
  const b = parts(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  // Same numbers: a letter suffix ("2609a" vs "2609") can still be newer, but a
  // channel label like "(Canary)" isn't part of the version.
  const strip = (v: string): string => v.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const a2 = strip(latest);
  const b2 = strip(installed);
  return a2 !== b2 && a2.localeCompare(b2, undefined, { numeric: true }) > 0;
}
