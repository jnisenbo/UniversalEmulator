import { basename, dirname, extname } from 'node:path';

/**
 * Display title from a filename: drop extension and dump-tool tags such as
 * "(USA)", "[0100…]", "[v0]", "(Rev 1)" while keeping the readable name.
 */
export function titleFromPath(path: string): string {
  const file = basename(path);
  // Loose executables and extracted discs are named after their folder.
  const name = /^default\.xex$/i.test(file) ? basename(dirname(path)) : file.slice(0, file.length - extname(file).length);
  const cleaned = name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*\b(?:USA|Europe|Japan|World|En|Fr|De|Es|It|Rev|v\d|Disc|NTSC|PAL)\b[^)]*)\)/gi, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || name;
}
