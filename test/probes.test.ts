import { createCipheriv } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bufferReader } from '../src/main/library/probes/io';
import { probeReader } from '../src/main/library/probes/index';
import { contentKind, decryptNcaHeader, titleIdFromFileName } from '../src/main/library/probes/switch';
import { parseHeaderKey } from '../src/main/library/probes/switch-keys';

const noKeys = { switchHeaderKey: null };

function discHeader(id: string, title: string, wii: boolean, disc = 0): Buffer {
  const h = Buffer.alloc(0x80);
  h.write(id, 0, 'latin1');
  h.writeUInt8(disc, 6);
  if (wii) h.writeUInt32BE(0x5d1c9ea3, 0x18);
  else h.writeUInt32BE(0xc2339f3d, 0x1c);
  h.write(title, 0x20, 'latin1');
  return h;
}

describe('GameCube / Wii', () => {
  it('reads a GameCube ISO header', async () => {
    const img = Buffer.concat([discHeader('GALE01', 'Super Smash Bros Melee', false, 0), Buffer.alloc(4096)]);
    const id = await probeReader(bufferReader(img), 'melee.iso', noKeys);
    expect(id).toMatchObject({ platform: 'gamecube', gameId: 'GALE01', title: 'Super Smash Bros Melee', format: 'iso', identified: true });
  });

  it('reads a second disc number', async () => {
    const img = discHeader('GXXE01', 'Two Disc Game', false, 1);
    expect((await probeReader(bufferReader(img), 'x.iso', noKeys))?.discNumber).toBe(1);
  });

  it('reads a WBFS header at hd sector 1', async () => {
    const img = Buffer.alloc(0x200 + 0x80);
    img.write('WBFS', 0, 'latin1');
    img.writeUInt8(9, 8); // 512-byte hd sectors
    discHeader('RMGE01', 'Super Mario Galaxy', true).copy(img, 0x200);
    expect(await probeReader(bufferReader(img), 'galaxy.wbfs', noKeys)).toMatchObject({ platform: 'wii', gameId: 'RMGE01', format: 'wbfs' });
  });

  it('reads RVZ disc header at 0x58', async () => {
    const img = Buffer.alloc(0x58 + 0x80);
    img.write('RVZ\x01', 0, 'latin1');
    discHeader('SB4E01', 'Galaxy 2', true).copy(img, 0x58);
    expect(await probeReader(bufferReader(img), 'g2.rvz', noKeys)).toMatchObject({ platform: 'wii', gameId: 'SB4E01', format: 'rvz' });
  });

  it('inflates the first GCZ block', async () => {
    const blockSize = 0x4000;
    const block0 = Buffer.alloc(blockSize);
    discHeader('GM4E01', 'Mario Kart Double Dash', false).copy(block0, 0);
    const z0 = deflateSync(block0);
    const numBlocks = 2;
    const head = Buffer.alloc(32);
    head.writeUInt32LE(0xb10bc001, 0);
    head.writeUInt32LE(blockSize, 24);
    head.writeUInt32LE(numBlocks, 28);
    const ptrs = Buffer.alloc(16);
    ptrs.writeBigUInt64LE(0n, 0);
    ptrs.writeBigUInt64LE(BigInt(z0.length), 8);
    const img = Buffer.concat([head, ptrs, Buffer.alloc(numBlocks * 4), z0, Buffer.alloc(64)]);
    expect(await probeReader(bufferReader(img), 'mk.gcz', noKeys)).toMatchObject({ platform: 'gamecube', gameId: 'GM4E01', format: 'gcz' });
  });

  it('rejects unrelated data', async () => {
    expect(await probeReader(bufferReader(Buffer.alloc(0x20000)), 'blank.iso', noKeys)).toBeNull();
  });
});

function pfs0(files: { name: string; data: Buffer }[]): Buffer {
  const names = Buffer.concat(files.map((f) => Buffer.from(f.name + '\0')));
  const strSize = Math.ceil(names.length / 0x20) * 0x20;
  const head = Buffer.alloc(16 + files.length * 0x18 + strSize);
  head.write('PFS0', 0, 'latin1');
  head.writeUInt32LE(files.length, 4);
  head.writeUInt32LE(strSize, 8);
  let dataOff = 0;
  let nameOff = 0;
  files.forEach((f, i) => {
    const e = 16 + i * 0x18;
    head.writeBigUInt64LE(BigInt(dataOff), e);
    head.writeBigUInt64LE(BigInt(f.data.length), e + 8);
    head.writeUInt32LE(nameOff, e + 16);
    dataOff += f.data.length;
    nameOff += f.name.length + 1;
  });
  names.copy(head, 16 + files.length * 0x18);
  return Buffer.concat([head, ...files.map((f) => f.data)]);
}

const HEADER_KEY = Buffer.from('00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210', 'hex');

function encryptedNca(titleId: bigint, contentType: number): Buffer {
  const plain = Buffer.alloc(0x400);
  plain.write('NCA3', 0x200, 'latin1');
  plain.writeUInt8(contentType, 0x205);
  plain.writeBigUInt64LE(titleId, 0x210);
  const out: Buffer[] = [];
  for (let s = 0; s < 2; s++) {
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(s), 8);
    const c = createCipheriv('aes-128-xts', HEADER_KEY, iv);
    c.setAutoPadding(false);
    out.push(c.update(plain.subarray(s * 0x200, (s + 1) * 0x200)), c.final());
  }
  return Buffer.concat([...out, Buffer.alloc(0x200)]);
}

describe('Switch', () => {
  it('reads the title ID from an NCA header with the user header key', async () => {
    const img = pfs0([
      { name: 'aaaa.cnmt.nca', data: encryptedNca(0x0100000000010000n, 1) },
      { name: 'bbbb.nca', data: Buffer.concat([encryptedNca(0x0100000000010000n, 0), Buffer.alloc(0x1000)]) },
    ]);
    const id = await probeReader(bufferReader(img), 'whatever.nsp', { switchHeaderKey: HEADER_KEY });
    expect(id).toMatchObject({ platform: 'switch', gameId: '0100000000010000', contentKind: 'base', identified: true });
  });

  it('round-trips Nintendo-tweak XTS', () => {
    const dec = decryptNcaHeader(encryptedNca(0x01007ef00011e000n, 0).subarray(0, 0x400), HEADER_KEY);
    expect(dec.toString('latin1', 0x200, 0x204)).toBe('NCA3');
  });

  it('falls back to the ticket name without keys', async () => {
    const img = pfs0([
      { name: '01007ef00011e0000000000000000004.tik', data: Buffer.alloc(0x2c0) },
      { name: 'cccc.nca', data: Buffer.alloc(0x400) },
    ]);
    expect(await probeReader(bufferReader(img), 'zelda.nsp', noKeys)).toMatchObject({ gameId: '01007EF00011E000', contentKind: 'base' });
  });

  it('falls back to the filename tag', async () => {
    const img = pfs0([{ name: 'cccc.nca', data: Buffer.alloc(0x400) }]);
    expect((await probeReader(bufferReader(img), 'Game [0100ABCDEF012800][v65536].nsp', noKeys))?.contentKind).toBe('update');
  });

  it('classifies title IDs', () => {
    expect(contentKind('0100ABCDEF012000')).toBe('base');
    expect(contentKind('0100ABCDEF012800')).toBe('update');
    expect(contentKind('0100ABCDEF013001')).toBe('dlc');
    expect(titleIdFromFileName('Mario [0100abcdef012000].xci')).toBe('0100ABCDEF012000');
  });

  it('parses header_key from prod.keys', () => {
    const text = `master_key_00 = ${'ab'.repeat(16)}\nheader_key = ${HEADER_KEY.toString('hex')}\n`;
    expect(parseHeaderKey(text)?.equals(HEADER_KEY)).toBe(true);
  });

  it('reads an XCI secure partition', async () => {
    const hfs0 = (files: { name: string; data: Buffer }[]): Buffer => {
      const names = Buffer.concat(files.map((f) => Buffer.from(f.name + '\0')));
      const head = Buffer.alloc(16 + files.length * 0x40 + names.length);
      head.write('HFS0', 0, 'latin1');
      head.writeUInt32LE(files.length, 4);
      head.writeUInt32LE(names.length, 8);
      let d = 0;
      let n = 0;
      files.forEach((f, i) => {
        const e = 16 + i * 0x40;
        head.writeBigUInt64LE(BigInt(d), e);
        head.writeBigUInt64LE(BigInt(f.data.length), e + 8);
        head.writeUInt32LE(n, e + 16);
        d += f.data.length;
        n += f.name.length + 1;
      });
      names.copy(head, 16 + files.length * 0x40);
      return Buffer.concat([head, ...files.map((f) => f.data)]);
    };
    const secure = hfs0([{ name: 'p.nca', data: encryptedNca(0x0100152000022000n, 0) }]);
    const root = hfs0([{ name: 'secure', data: secure }]);
    const rootOffset = 0x200;
    const header = Buffer.alloc(rootOffset);
    header.write('HEAD', 0x100, 'latin1');
    header.writeBigUInt64LE(BigInt(rootOffset), 0x130);
    const img = Buffer.concat([header, root]);
    expect(await probeReader(bufferReader(img), 'mk8.xci', { switchHeaderKey: HEADER_KEY })).toMatchObject({ format: 'xci', gameId: '0100152000022000' });
  });
});

function xex(titleId: number, disc = 1): Buffer {
  const b = Buffer.alloc(0x200);
  b.write('XEX2', 0, 'latin1');
  b.writeUInt32BE(1, 0x14);
  b.writeUInt32BE(0x00040006, 0x18);
  b.writeUInt32BE(0x100, 0x1c);
  b.writeUInt32BE(titleId, 0x100 + 0x0c);
  b.writeUInt8(disc, 0x100 + 0x12);
  return b;
}

describe('Xbox 360', () => {
  it('finds default.xex in an XGD2 game partition', async () => {
    const base = 0xfd90000;
    const rootSector = 0x30;
    const xexSector = 0x40;
    const img = Buffer.alloc(base + xexSector * 2048 + 0x1000);
    const vd = base + 0x10000;
    img.write('MICROSOFT*XBOX*MEDIA', vd, 'latin1');
    img.writeUInt32LE(rootSector, vd + 20);
    img.writeUInt32LE(2048, vd + 24);
    // Root dir: "media" entry whose right child is "default.xex".
    const dir = base + rootSector * 2048;
    const entry = (at: number, left: number, right: number, sector: number, name: string): void => {
      img.writeUInt16LE(left, at);
      img.writeUInt16LE(right, at + 2);
      img.writeUInt32LE(sector, at + 4);
      img.writeUInt32LE(0x200, at + 8);
      img.writeUInt8(0x10, at + 12);
      img.writeUInt8(name.length, at + 13);
      img.write(name, at + 14, 'latin1');
    };
    entry(dir, 0, 8, 0, 'media');
    entry(dir + 32, 0, 0, xexSector, 'default.xex');
    xex(0x4d5307e6).copy(img, base + xexSector * 2048);
    expect(await probeReader(bufferReader(img), 'halo3.iso', noKeys)).toMatchObject({ platform: 'xbox360', format: 'xiso', gameId: '4D5307E6', identified: true });
  });

  it('reads a loose default.xex', async () => {
    expect(await probeReader(bufferReader(xex(0x415607e1, 2)), 'default.xex', noKeys)).toMatchObject({ gameId: '415607E1', discNumber: 1 });
  });

  it('reads an XBLA STFS package', async () => {
    const b = Buffer.alloc(0x600);
    b.write('LIVE', 0, 'latin1');
    b.writeUInt32BE(0x000d0000, 0x344);
    b.writeUInt32BE(0x58410a6d, 0x360);
    const name = Buffer.from('Braid', 'utf16le');
    name.swap16();
    name.copy(b, 0x411);
    expect(await probeReader(bufferReader(b), '1A2B3C4D5E6F', noKeys)).toMatchObject({ format: 'stfs', gameId: '58410A6D', title: 'Braid' });
  });

  it('ignores STFS saves', async () => {
    const b = Buffer.alloc(0x600);
    b.write('CON ', 0, 'latin1');
    b.writeUInt32BE(0x00000001, 0x344);
    expect(await probeReader(bufferReader(b), 'SAVE0001', noKeys)).toBeNull();
  });
});
