/**
 * Minimal INI model matching Dolphin's files: `[Section]`, `Key = Value`.
 * Order of sections and keys is preserved so diffs against Dolphin's own
 * writes stay small.
 */
export type Ini = Map<string, Map<string, string>>;

export function parseIni(text: string): Ini {
  const ini: Ini = new Map();
  let section: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec?.[1]) {
      section = ini.get(sec[1]) ?? new Map();
      ini.set(sec[1], section);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !section) continue;
    section.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return ini;
}

export function setIni(ini: Ini, section: string, values: Record<string, string>): void {
  const sec = ini.get(section) ?? new Map<string, string>();
  for (const [k, v] of Object.entries(values)) sec.set(k, v);
  ini.set(section, sec);
}

export function stringifyIni(ini: Ini): string {
  const out: string[] = [];
  for (const [name, entries] of ini) {
    out.push(`[${name}]`);
    for (const [k, v] of entries) out.push(`${k} = ${v}`);
  }
  return out.join('\n') + '\n';
}
