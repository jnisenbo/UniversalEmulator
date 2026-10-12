import type { ControllerProfile } from '@shared/settings';
import { setIni, type Ini } from '../../util/ini';

/**
 * Dolphin input names come from its SDL backend (SDLGamepad.h):
 * buttons are positional ("Button S" = bottom face), vertical axes are
 * flipped to XInput convention so "Left Y+" means up.
 */
const q = (name: string): string => `\`${name}\``;
const pct = (fraction: number): string => (fraction * 100).toFixed(1);

function stick(prefix: string, side: 'Left' | 'Right', deadzone: number): Record<string, string> {
  return {
    [`${prefix}/Up`]: q(`${side} Y+`),
    [`${prefix}/Down`]: q(`${side} Y-`),
    [`${prefix}/Left`]: q(`${side} X-`),
    [`${prefix}/Right`]: q(`${side} X+`),
    [`${prefix}/Dead Zone`]: pct(deadzone),
  };
}

const dpad = (prefix: string): Record<string, string> => ({
  [`${prefix}/Up`]: q('Pad N'),
  [`${prefix}/Down`]: q('Pad S'),
  [`${prefix}/Left`]: q('Pad W'),
  [`${prefix}/Right`]: q('Pad E'),
});

/**
 * GameCube pad, laid out by position on a DualSense:
 * A = bottom (big button), B = left, X = right, Y = top, Z = R1.
 */
export function gcPadIni(p: ControllerProfile): Ini {
  const ini: Ini = new Map();
  setIni(ini, 'GCPad1', {
    Device: p.dolphinDevice,
    'Buttons/A': q('Button S'),
    'Buttons/B': q('Button W'),
    'Buttons/X': q('Button E'),
    'Buttons/Y': q('Button N'),
    'Buttons/Z': q('Shoulder R'),
    'Buttons/Start': q('Start'),
    ...stick('Main Stick', 'Left', p.deadzoneLeft),
    ...stick('C-Stick', 'Right', p.deadzoneRight),
    'Triggers/L': q('Trigger L'),
    'Triggers/R': q('Trigger R'),
    'Triggers/L-Analog': q('Trigger L'),
    'Triggers/R-Analog': q('Trigger R'),
    'Triggers/Threshold': pct(p.triggerThreshold),
    ...dpad('D-Pad'),
    'Rumble/Motor': p.rumble ? `${q('Motor L')} | ${q('Motor R')}` : '',
  });
  for (const n of [2, 3, 4]) setIni(ini, `GCPad${n}`, { Device: p.dolphinDevice });
  return ini;
}

/**
 * Wii Remote + Nunchuk, the layout most Wii games expect.
 * Pointer on the right stick; DualSense gyro/accelerometer drive Wii motion.
 * Home is on the touchpad click because the controller's Home button belongs
 * to Arcadia (hold to quit).
 */
export function wiimoteIni(p: ControllerProfile): Ini {
  const ini: Ini = new Map();
  const motion: Record<string, string> = p.motion
    ? {
        'IMUAccelerometer/Up': q('Accel Up'),
        'IMUAccelerometer/Down': q('Accel Down'),
        'IMUAccelerometer/Left': q('Accel Left'),
        'IMUAccelerometer/Right': q('Accel Right'),
        'IMUAccelerometer/Forward': q('Accel Forward'),
        'IMUAccelerometer/Backward': q('Accel Backward'),
        'IMUGyroscope/Pitch Up': q('Gyro Pitch Up'),
        'IMUGyroscope/Pitch Down': q('Gyro Pitch Down'),
        'IMUGyroscope/Roll Left': q('Gyro Roll Left'),
        'IMUGyroscope/Roll Right': q('Gyro Roll Right'),
        'IMUGyroscope/Yaw Left': q('Gyro Yaw Left'),
        'IMUGyroscope/Yaw Right': q('Gyro Yaw Right'),
      }
    : {};
  setIni(ini, 'Wiimote1', {
    Device: p.dolphinDevice,
    Source: '1',
    'Buttons/A': q('Button S'),
    'Buttons/B': q('Trigger R'),
    'Buttons/1': q('Button W'),
    'Buttons/2': q('Button N'),
    'Buttons/-': q('Back'),
    'Buttons/+': q('Start'),
    'Buttons/Home': q('Touchpad'),
    ...dpad('D-Pad'),
    'IR/Up': q('Right Y+'),
    'IR/Down': q('Right Y-'),
    'IR/Left': q('Right X-'),
    'IR/Right': q('Right X+'),
    'IR/Dead Zone': pct(p.deadzoneRight),
    'IR/Relative Input': 'True',
    'Shake/X': q('Button E'),
    'Shake/Y': q('Button E'),
    'Shake/Z': q('Button E'),
    ...motion,
    Extension: 'Nunchuk',
    'Nunchuk/Buttons/C': q('Shoulder L'),
    'Nunchuk/Buttons/Z': q('Trigger L'),
    ...stick('Nunchuk/Stick', 'Left', p.deadzoneLeft),
    'Nunchuk/Shake/X': q('Thumb L'),
    'Nunchuk/Shake/Y': q('Thumb L'),
    'Nunchuk/Shake/Z': q('Thumb L'),
    'Rumble/Motor': p.rumble ? `${q('Motor L')} | ${q('Motor R')}` : '',
  });
  for (const n of [2, 3, 4]) setIni(ini, `Wiimote${n}`, { Source: '0' });
  setIni(ini, 'BalanceBoard', { Source: '0' });
  return ini;
}

/** Keys Arcadia owns in Dolphin.ini. Everything else the user sets in Dolphin is kept. */
export function applyDolphinIni(ini: Ini): Ini {
  setIni(ini, 'Display', { Fullscreen: 'True' });
  setIni(ini, 'Interface', { ConfirmStop: 'False', PauseOnFocusLost: 'False' });
  setIni(ini, 'Analytics', { PermissionAsked: 'True', Enabled: 'False' });
  setIni(ini, 'Core', { SIDevice0: '6' }); // 6 = standard GameCube controller
  setIni(ini, 'BluetoothPassthrough', { Enabled: 'False' });
  return ini;
}
