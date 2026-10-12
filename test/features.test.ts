import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignButton, compactLayout, LAYOUT_PRESETS, resolveButton } from '../src/shared/controls';
import { ControllerProfileSchema, GraphicsSchema, SettingsSchema } from '../src/shared/settings';
import { applyGfxIni, gcPadIni } from '../src/main/emulators/dolphin/config';
import { patchRyubingConfig } from '../src/main/emulators/ryubing/config';
import { patchXemuConfig } from '../src/main/emulators/xemu/config';
import { bufferReader } from '../src/main/library/probes/io';
import { probeReader } from '../src/main/library/probes/index';
import { parseXbeCertificate } from '../src/main/library/probes/xbox360';
import { CATALOG, hostAllowed } from '../src/main/install/catalog';
import { resolveRelease, type JsonFetch } from '../src/main/install/resolve';
import { findApp } from '../src/main/install/installer';
import { ArtStore, artKey } from '../src/main/art/store';
import { SteamGridDbClient, type Fetch } from '../src/main/art/steamgriddb';
import { mergeOneLevel } from '../src/main/settings/store';
import type { Game } from '../src/shared/types';

const swapFace = LAYOUT_PRESETS.find((p) => p.id === 'swap-face')!.layout;

describe('button layouts', () => {
  it('swaps when assigning a button that is already used', () => {
    const l = assignButton({}, 'south', 'east');
    expect(resolveButton(l, 'south')).toBe('east');
    expect(resolveButton(l, 'east')).toBe('south');
    expect(Object.keys(l)).toHaveLength(2);
  });

  it('drops identity entries and returns to default when swapped back', () => {
    const l = assignButton(assignButton({}, 'south', 'east'), 'south', 'south');
    expect(compactLayout(l)).toEqual({});
  });

  it('replaces the layout object whole when settings are patched', () => {
    const base = SettingsSchema.parse({ controller: { layout: { south: 'east', east: 'south' } } });
    const next = mergeOneLevel(base, { controller: { layout: {} } });
    expect(next.controller.layout).toEqual({});
    expect(next.controller.deadzoneLeft).toBe(0.1);
  });

  it('flows into Dolphin, Ryubing and xemu', () => {
    const p = ControllerProfileSchema.parse({ layout: swapFace });
    expect(gcPadIni(p).get('GCPad1')!.get('Buttons/A')).toBe('`Button E`');
    const ryu = patchRyubingConfig({ input_config: [{ backend: 'GamepadSDL2', right_joycon: {}, left_joycon: {}, left_joycon_stick: {}, right_joycon_stick: {} }] }, p);
    const pad = (ryu.config.input_config as Record<string, Record<string, string>>[])[0]!;
    // Switch A is the right button by default; with faces swapped it moves to the bottom.
    expect(pad.right_joycon!.button_a).toBe('A');
    expect(pad.left_joycon_stick!.stick_button).toBe('LeftStick');
    const xemu = patchXemuConfig({ input: { gamepad_mappings: [{ gamepad_id: 'abc', controller_mapping: {} }] }, sys: { files: { bootrom_path: 'a', flashrom_path: 'b', hdd_path: 'c' } } }, p, GraphicsSchema.parse({}));
    const cm = ((xemu.config.input as Record<string, unknown>).gamepad_mappings as Record<string, Record<string, number>>[])[0]!.controller_mapping!;
    expect(cm.a).toBe(1); // SDL "B"/east drives Xbox A
    expect(xemu.missingFiles).toEqual([]);
  });

  it('reports xemu buttons it cannot remap onto triggers', () => {
    const p = ControllerProfileSchema.parse({ layout: { south: 'l2', l2: 'south' } });
    const r = patchXemuConfig({ input: { gamepad_mappings: [{ gamepad_id: 'x' }] } }, p, GraphicsSchema.parse({}));
    expect(r.skippedButtons.sort()).toEqual(['l2', 'south']);
  });
});

describe('graphics', () => {
  const g = GraphicsSchema.parse({ resolutionScale: 3, vsync: false, aspect: '16:9', showFps: true });
  it('writes Dolphin GFX.ini', () => {
    const ini = applyGfxIni(new Map(), g);
    expect(ini.get('Settings')!.get('InternalResolution')).toBe('3');
    expect(ini.get('Settings')!.get('AspectRatio')).toBe('1');
    expect(ini.get('Hardware')!.get('VSync')).toBe('False');
  });
  it('patches only Ryubing keys that exist, preferring vsync_mode', () => {
    const r = patchRyubingConfig({ res_scale: 1, aspect_ratio: 'Fixed16x9', vsync_mode: 'Switch' }, ControllerProfileSchema.parse({}), g);
    expect(r.config).toMatchObject({ res_scale: 3, vsync_mode: 'Unbounded' });
    expect(r.config).not.toHaveProperty('enable_vsync');
  });
  it('flags missing xemu system files and sets fullscreen', () => {
    const r = patchXemuConfig({}, ControllerProfileSchema.parse({}), g);
    expect(r.missingFiles).toEqual(['bootrom_path', 'flashrom_path', 'hdd_path']);
    expect((r.config.display as Record<string, Record<string, unknown>>).window!.fullscreen_on_startup).toBe(true);
  });
});

function xbe(titleId: number, title: string): Buffer {
  const b = Buffer.alloc(0x400);
  b.write('XBEH', 0, 'latin1');
  b.writeUInt32LE(0x10000, 0x104);
  b.writeUInt32LE(0x10000 + 0x200, 0x118);
  b.writeUInt32LE(titleId, 0x200 + 8);
  b.write(title, 0x200 + 0x0c, 'utf16le');
  return b;
}

describe('original Xbox', () => {
  it('reads the XBE certificate', () => {
    expect(parseXbeCertificate(xbe(0x4d530004, 'Halo'))).toEqual({ titleId: '4D530004', title: 'Halo' });
  });
  it('identifies an XISO with default.xbe and flags full dumps', async () => {
    for (const base of [0, 0x18300000]) {
      const img = Buffer.alloc(base + 0x40 * 2048 + 0x1000);
      const vd = base + 0x10000;
      img.write('MICROSOFT*XBOX*MEDIA', vd, 'latin1');
      img.writeUInt32LE(0x30, vd + 20);
      img.writeUInt32LE(2048, vd + 24);
      const dir = base + 0x30 * 2048;
      img.writeUInt32LE(0x40, dir + 4);
      img.writeUInt32LE(0x400, dir + 8);
      img.writeUInt8(11, dir + 13);
      img.write('default.xbe', dir + 14, 'latin1');
      xbe(0x4d530004, 'Halo').copy(img, base + 0x40 * 2048);
      const id = await probeReader(bufferReader(img), 'halo.iso', { switchHeaderKey: null });
      expect(id).toMatchObject({ platform: 'xbox', gameId: '4D530004', title: 'Halo' });
      expect(!!id?.note).toBe(base !== 0);
    }
  });
});

const json = (body: unknown, ok = true): ReturnType<JsonFetch> => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body });

describe('emulator installer', () => {
  it('allows only https on listed hosts', () => {
    expect(hostAllowed('https://dl.dolphin-emu.org/x.dmg', CATALOG.dolphin.hosts)).toBe(true);
    expect(hostAllowed('http://dl.dolphin-emu.org/x.dmg', CATALOG.dolphin.hosts)).toBe(false);
    expect(hostAllowed('https://dl.dolphin-emu.org.evil.com/x.dmg', CATALOG.dolphin.hosts)).toBe(false);
  });

  it('prefers the arm64 variation of a cask', async () => {
    const sha = 'a'.repeat(64);
    const r = await resolveRelease(CATALOG.dolphin, (url) =>
      json({ version: '2512,abc', url: 'https://dl.dolphin-emu.org/intel.dmg', sha256: 'b'.repeat(64), variations: { arm64_sequoia: { url: 'https://dl.dolphin-emu.org/arm.dmg', sha256: sha } } }),
    );
    expect(r).toMatchObject({ version: '2512', url: 'https://dl.dolphin-emu.org/arm.dmg', sha256: sha });
  });

  it('falls back to GitHub with the asset digest', async () => {
    const fetchJson: JsonFetch = (url) =>
      url.includes('formulae.brew.sh')
        ? json({}, false)
        : json({ tag_name: 'v0.8.136', assets: [{ name: 'xemu-0.8.136-windows-x86_64.zip', browser_download_url: 'https://github.com/a' }, { name: 'xemu-0.8.136-macos-universal.zip', browser_download_url: 'https://github.com/xemu-project/xemu/releases/download/v0.8.136/xemu-0.8.136-macos-universal.zip', digest: `sha256:${'c'.repeat(64)}` }] });
    expect(await resolveRelease(CATALOG.xemu, fetchJson)).toMatchObject({ version: '0.8.136', sha256: 'c'.repeat(64) });
  });

  it('rejects a source that points somewhere unexpected', async () => {
    await expect(resolveRelease(CATALOG.dolphin, () => json({ version: '1', url: 'https://evil.example/x.dmg' }))).rejects.toThrow(/unexpected host/);
  });

  it('finds the app inside an extracted archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-'));
    await mkdir(join(root, 'release', 'Ryujinx.app', 'Contents'), { recursive: true });
    expect(await findApp(root, CATALOG.ryubing.appName)).toBe(join(root, 'release', 'Ryujinx.app'));
  });
});

describe('artwork', () => {
  const game = { id: 'p1', platform: 'wii', gameId: 'RMGE01', displayTitle: 'Super Mario Galaxy' } as Game;

  it('keys art by platform and game ID and resolves only known files', async () => {
    expect(artKey(game)).toBe('wii-rmge01');
    const store = new ArtStore(await mkdtemp(join(tmpdir(), 'arcadia-')));
    expect(store.filePath('arcadia-art://wii-rmge01/grid')).toBeNull();
    expect(store.filePath('arcadia-art://../../etc/grid')).toBeNull();
    expect(store.needsFetch(game)).toBe(true);
  });

  it('downloads grid, hero and logo for the first search match', async () => {
    const calls: string[] = [];
    const png = new Uint8Array([137, 80, 78, 71]).buffer;
    const fetchFn: Fetch = async (url) => {
      calls.push(url);
      const body = url.includes('/search/') ? { data: [{ id: 42, name: 'Super Mario Galaxy' }] } : url.includes('/logos/') ? { data: [] } : { data: [{ url: `https://cdn2.steamgriddb.com/${url.includes('heroes') ? 'h' : 'g'}.png` }] };
      return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => png, headers: { get: () => 'image/png' } };
    };
    const store = new ArtStore(await mkdtemp(join(tmpdir(), 'arcadia-')));
    const art = await store.fetch(game, new SteamGridDbClient('key', fetchFn));
    expect(art).toMatchObject({ sourceId: 42, grid: expect.stringMatching(/^arcadia-art:\/\/wii-rmge01\/grid\?v=/), hero: expect.any(String) });
    expect(art?.logo).toBeUndefined();
    expect(store.filePath(art!.grid!)).toMatch(/grid\.png$/);
    expect(calls[0]).toContain('/search/autocomplete/Super%20Mario%20Galaxy');
  });
});

describe('emulator installer: Forgejo', () => {
  it('reads Ryubing releases from its Forgejo server', async () => {
    const fetchJson: JsonFetch = (url) =>
      url.startsWith('https://git.ryujinx.app/api/v1/repos/Ryubing/Stable/')
        ? json({ tag_name: '1.3.3', assets: [{ name: 'ryujinx-1.3.3-linux_x64.tar.gz', browser_download_url: 'https://git.ryujinx.app/x' }, { name: 'ryujinx-1.3.3-macos_universal.app.tar.gz', browser_download_url: 'https://git.ryujinx.app/Ryubing/Stable/releases/download/1.3.3/ryujinx-1.3.3-macos_universal.app.tar.gz' }] })
        : json({}, false);
    expect(await resolveRelease(CATALOG.ryubing, fetchJson)).toMatchObject({ version: '1.3.3', sha256: null, source: 'git.ryujinx.app/Ryubing/Stable' });
  });

  it('explains which sources were tried', async () => {
    await expect(resolveRelease(CATALOG.ryubing, () => json({}, false))).rejects.toThrow(/Ryubing\/Stable: no macOS build/);
  });
});
