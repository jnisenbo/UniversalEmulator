import { describe, expect, it } from 'vitest';
import { ControllerProfileSchema, SettingsSchema } from '../src/shared/settings';
import { applyDolphinIni, gcPadIni, wiimoteIni } from '../src/main/emulators/dolphin/config';
import { patchRyubingConfig } from '../src/main/emulators/ryubing/config';
import { expandArgs } from '../src/main/emulators/xenia/adapter';
import { titleFromPath } from '../src/main/library/title';
import { mergeOneLevel } from '../src/main/settings/store';
import { parseIni, stringifyIni } from '../src/main/util/ini';

const profile = ControllerProfileSchema.parse({ deadzoneLeft: 0.12 });

describe('Dolphin config', () => {
  it('maps the GameCube pad by position with backtick-quoted SDL names', () => {
    const pad = gcPadIni(profile).get('GCPad1')!;
    expect(pad.get('Device')).toBe('SDL/0/DualSense Wireless Controller');
    expect(pad.get('Buttons/A')).toBe('`Button S`');
    expect(pad.get('Main Stick/Up')).toBe('`Left Y+`');
    expect(pad.get('Main Stick/Dead Zone')).toBe('12.0');
    expect(pad.get('Rumble/Motor')).toBe('`Motor L` | `Motor R`');
  });

  it('keeps Home on the touchpad for Wii and drops motion when disabled', () => {
    const wm = wiimoteIni({ ...profile, motion: false }).get('Wiimote1')!;
    expect(wm.get('Buttons/Home')).toBe('`Touchpad`');
    expect(wm.get('Extension')).toBe('Nunchuk');
    expect([...wm.keys()].some((k) => k.startsWith('IMU'))).toBe(false);
  });

  it('preserves user keys in Dolphin.ini and sets the ones Arcadia owns', () => {
    const ini = applyDolphinIni(parseIni('[Core]\nCPUThread = True\n[Display]\nFullscreen = False\n'));
    const text = stringifyIni(ini);
    expect(text).toContain('CPUThread = True');
    expect(text).toContain('Fullscreen = True');
    expect(text).toContain('ConfirmStop = False');
  });
});

describe('Ryubing config', () => {
  const source = {
    start_fullscreen: false,
    show_confirm_exit: true,
    input_config: [
      { backend: 'GamepadSDL2', id: '0-abc', deadzone_left: 0.05, left_joycon: { button_minus: 'Back' }, right_joycon: { button_a: 'A' }, rumble: { enable_rumble: false }, motion: { enable_motion: false } },
      { backend: 'WindowKeyboard', id: '0' },
    ],
  };

  it('patches existing keys and tunes only gamepad entries', () => {
    const { config, controllersUpdated, missingKeys } = patchRyubingConfig(source, profile);
    expect(config.start_fullscreen).toBe(true);
    expect(config.show_confirm_exit).toBe(false);
    expect(missingKeys).toEqual(['check_updates_on_start']);
    expect(controllersUpdated).toBe(1);
    const [pad, kb] = config.input_config as Record<string, any>[];
    expect(pad!.id).toBe('0-abc');
    expect(pad!.deadzone_left).toBe(0.12);
    expect(pad!.right_joycon.button_a).toBe('B');
    expect(pad!.rumble.enable_rumble).toBe(true);
    expect(kb).toEqual({ backend: 'WindowKeyboard', id: '0' });
    expect(source.start_fullscreen).toBe(false); // input not mutated
  });
});

describe('helpers', () => {
  it('expands Xenia argument templates', () => {
    expect(expandArgs('{game} --fullscreen=true', '/g/Halo 3.iso')).toEqual(['/g/Halo 3.iso', '--fullscreen=true']);
    expect(expandArgs('--fullscreen', '/g/a.xex')).toEqual(['--fullscreen', '/g/a.xex']);
  });

  it('cleans dump filenames into titles', () => {
    expect(titleFromPath('/x/Super Mario Galaxy (USA) (En,Fr,Es).rvz')).toBe('Super Mario Galaxy');
    expect(titleFromPath('/x/Zelda [01007EF00011E000][v0].nsp')).toBe('Zelda');
    expect(titleFromPath('/x/Halo 3/default.xex')).toBe('Halo 3');
  });

  it('merges settings patches one object at a time', () => {
    const base = SettingsSchema.parse({});
    const next = SettingsSchema.parse(mergeOneLevel(base, { emulators: { dolphin: { appPath: '/Applications/Dolphin.app' } } }));
    expect(next.emulators.dolphin.appPath).toBe('/Applications/Dolphin.app');
    expect(next.emulators.xenia.argsTemplate).toBe('{game} --fullscreen=true');
  });
});
