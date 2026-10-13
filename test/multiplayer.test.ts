import { describe, expect, it } from 'vitest';
import { ControllerProfileSchema } from '../src/shared/settings';
import { applyDolphinIni, applyGfxIni, dolphinPlayers, gcPadIni, wiimoteIni } from '../src/main/emulators/dolphin/config';
import { GraphicsSchema } from '../src/shared/settings';

const p = ControllerProfileSchema.parse({});
const ds = { name: 'DualSense Wireless Controller' };
const xb = { name: 'Xbox Wireless Controller' };

describe('Dolphin multiplayer', () => {
  it('numbers controllers per name, as Dolphin does', () => {
    expect(dolphinPlayers(p, [ds, xb, ds])).toEqual([
      'SDL/0/DualSense Wireless Controller',
      'SDL/0/Xbox Wireless Controller',
      'SDL/1/DualSense Wireless Controller',
    ]);
  });

  it('makes an Xbox pad player 1 when no DualSense is connected', () => {
    expect(dolphinPlayers(p, [xb])).toEqual(['SDL/0/Xbox Wireless Controller']);
  });

  it('caps at four players and honors the single player switch', () => {
    expect(dolphinPlayers(p, [ds, ds, ds, ds, xb])).toHaveLength(4);
    expect(dolphinPlayers({ ...p, multiplayer: false }, [ds, xb])).toEqual([p.dolphinDevice]);
  });

  it('falls back to the saved device when nothing is reported', () => {
    expect(dolphinPlayers(p, [])).toEqual([p.dolphinDevice]);
  });

  it('binds and enables a pad and Wii Remote per player', () => {
    const players = dolphinPlayers(p, [ds, xb]);
    const gc = gcPadIni(p, players);
    expect(gc.get('GCPad2')!.get('Device')).toBe('SDL/0/Xbox Wireless Controller');
    expect(gc.get('GCPad2')!.get('Buttons/A')).toBe('`Button S`');
    expect(gc.get('GCPad3')!.has('Buttons/A')).toBe(false);
    const wm = wiimoteIni(p, players);
    expect(wm.get('Wiimote2')!.get('Source')).toBe('1');
    expect(wm.get('Wiimote3')!.get('Source')).toBe('0');
    const core = applyDolphinIni(new Map(), 2).get('Core')!;
    expect(core.get('SIDevice1')).toBe('6');
    expect(core.get('SIDevice2')).toBe('0');
  });

  it('uses hybrid ubershaders to avoid shader stutter', () => {
    const gfx = applyGfxIni(new Map(), GraphicsSchema.parse({}));
    expect(gfx.get('Settings')!.get('ShaderCompilationMode')).toBe('2');
  });
});
