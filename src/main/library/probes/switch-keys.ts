import { readFile } from 'node:fs/promises';

/**
 * Reads only `header_key` from the user's own prod.keys (format: `name = hex`).
 * The file is read in place, never copied, and the key stays in memory.
 */
export async function loadHeaderKey(path: string): Promise<Buffer | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  return parseHeaderKey(text);
}

export function parseHeaderKey(text: string): Buffer | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*header_key\s*=\s*([0-9a-fA-F]{64})\s*$/.exec(line);
    if (m?.[1]) return Buffer.from(m[1], 'hex');
  }
  return null;
}
