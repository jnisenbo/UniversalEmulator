import { open, type FileHandle } from 'node:fs/promises';

/** Random-access reader over a file. Reads past EOF return a short buffer. */
export interface Reader {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

export async function withReader<T>(path: string, fn: (r: Reader) => Promise<T>): Promise<T> {
  const fh: FileHandle = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    return await fn({
      size,
      async read(offset, length) {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        return bytesRead === length ? buf : buf.subarray(0, bytesRead);
      },
    });
  } finally {
    await fh.close();
  }
}

/** In-memory reader, used by tests and for decompressed blocks. */
export function bufferReader(buf: Buffer): Reader {
  return {
    size: buf.length,
    async read(offset, length) {
      return buf.subarray(offset, Math.min(buf.length, offset + length));
    },
  };
}

/** Null-terminated, trimmed string from a fixed-size field. */
export function cString(buf: Buffer, encoding: BufferEncoding = 'latin1'): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString(encoding).trim();
}

/** Disc IDs are printable ASCII; anything else means we read the wrong bytes. */
export function isPrintableId(s: string, length: number): boolean {
  return s.length === length && /^[\x20-\x7e]+$/.test(s);
}
