import { resolveButton, type PadButton } from '@shared/controls';
import type { ControllerProfile, Graphics } from '@shared/settings';
import { setIni, type Ini } from '../../util/ini';

/**
 * Dolphin input names come from its SDL backend (SDLGamepad.h): buttons are
 * positional ("Button S" = bottom face), vertical axes are flipped to XInput
 * convention so "Left Y+" means up.
 */
const SDL_NAME: Record<PadButton, string> = {
  south: 'Button S', east: 'Button E', west: 'Button W', north: 'Button N',
  l1: 'Shoulder L', r1: 'Shoulder R', l2: 'Trigger L', r2: 'Trigger R',
  create: 'Back', options: 'Start', l3: 'Thumb L', r3: 'Thumb R',
  up: 'Pad N', down: 'Pad S', left: 'Pad W', right: 'Pad E',
  touchpad: 'Touchpad',
};

const q = (name: string): string => `\`${name}\``;
const pct = (fraction: number): string => (fraction * 100).toFixed(1);

/** Binding expression for a slot, after the user's layout is applied. */
const bind = (p: ControllerProfile, slot: PadButton): string => q(SDL_NAME[resolveButton(p.layout, slot)]);

function stick(prefix: string, side: 'Left' | 'Right', deadzone: number): Record<string, string> {
  return {
    [`${prefix}/Up`]: q(`${side} Y+`),
    [`${prefix}/Down`]: q(`${side} Y-`),
    [`${prefix}/Left`]: q(`${side} X-`),
    [`${prefix}/Right`]: q(`${side} X+`),
    [`${prefix}/Dead Zone`]: pct(deadzone),
  };
}

const dpad = (prefix: string, p: ControllerProfile): Record<string, string> => ({
  [`${prefix}/Up`]: bind(p, 'up'),
  [`${prefix}/Down`]: bind(p, 'down'),
  [`${prefix}/Left`]: bind(p, 'left'),
  [`${prefix}/Right`]: bind(p, 'right'),
});

const rumble = (p: ControllerProfile): string => (p.rumble ? `${q('Motor L')} | ${q('Motor R')}` : '');

/**
 * GameCube pad by position (see CONSOLE_BUTTONS.gamecube):
 * A = bottom (big button), B = left, X = right, Y = top, Z = R.
 */
export function gcPadIni(p: ControllerProfile): Ini {
  const ini: Ini = new Map();
  setIni(ini, 'GCPad1', {
    Device: p.dolphinDevice,
    'Buttons/A': bind(p, 'south'),
    'Buttons/B': bind(p, 'west'),
    'Buttons/X': bind(p, 'east'),
    'Buttons/Y': bind(p, 'north'),
    'Buttons/Z': bind(p, 'r1'),
    'Buttons/Start': bind(p, 'options'),
    ...stick('Main Stick', 'Left', p.deadzoneLeft),
    ...stick('C-Stick', 'Right', p.deadzoneRight),
    'Triggers/L': bind(p, 'l2'),
    'Triggers/R': bind(p, 'r2'),
    'Triggers/L-Analog': bind(p, 'l2'),
    'Triggers/R-Analog': bind(p, 'r2'),
    'Triggers/Threshold': pct(p.triggerThreshold),
    ...dpad('D-Pad', p),
    'Rumble/Motor': rumble(p),
  });
  for (const n of [2, 3, 4]) setIni(ini, `GCPad${n}`, { Device: p.dolphinDevice });
  return ini;
}

/**
 * Wii Remote + Nunchuk (see CONSOLE_BUTTONS.wii). Pointer on the right stick;
 * controller gyro/accelerometer drive Wii motion. Home is on the touchpad
 * because the controller's Home button opens Arcadia's in-game menu.
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
    'Buttons/A': bind(p, 'south'),
    'Buttons/B': bind(p, 'r2'),
    'Buttons/1': bind(p, 'west'),
    'Buttons/2': bind(p, 'north'),
    'Buttons/-': bind(p, 'create'),
    'Buttons/+': bind(p, 'options'),
    'Buttons/Home': bind(p, 'touchpad'),
    ...dpad('D-Pad', p),
    'IR/Up': q('Right Y+'),
    'IR/Down': q('Right Y-'),
    'IR/Left': q('Right X-'),
    'IR/Right': q('Right X+'),
    'IR/Dead Zone': pct(p.deadzoneRight),
    'IR/Relative Input': 'True',
    'Shake/X': bind(p, 'east'),
    'Shake/Y': bind(p, 'east'),
    'Shake/Z': bind(p, 'east'),
    ...motion,
    Extension: 'Nunchuk',
    'Nunchuk/Buttons/C': bind(p, 'l1'),
    'Nunchuk/Buttons/Z': bind(p, 'l2'),
    ...stick('Nunchuk/Stick', 'Left', p.deadzoneLeft),
    'Nunchuk/Shake/X': bind(p, 'l3'),
    'Nunchuk/Shake/Y': bind(p, 'l3'),
    'Nunchuk/Shake/Z': bind(p, 'l3'),
    'Rumble/Motor': rumble(p),
  });
  for (const n of [2, 3, 4]) setIni(ini, `Wiimote${n}`, { Source: '0' });
  setIni(ini, 'BalanceBoard', { Source: '0' });
  return ini;
}

/** Keys Arcadia owns in Dolphin.ini. Everything else the user sets in Dolphin is kept. */
export function applyDolphinIni(ini: Ini): Ini {
  setIni(ini, 'Display', { Fullscreen: 'True' });
  // Pausing when focus leaves Dolphin means the in-game menu (Home) pauses the game.
  setIni(ini, 'Interface', { ConfirmStop: 'False', PauseOnFocusLost: 'True' });
  setIni(ini, 'Analytics', { PermissionAsked: 'True', Enabled: 'False' });
  setIni(ini, 'Core', { SIDevice0: '6' }); // 6 = standard GameCube controller
  setIni(ini, 'BluetoothPassthrough', { Enabled: 'False' });
  return ini;
}

/** Dolphin's AspectMode enum: 0 Auto, 1 Force 16:9, 2 Force 4:3, 3 Stretch. */
const ASPECT: Record<Graphics['aspect'], string> = { auto: '0', '16:9': '1', '4:3': '2', stretch: '3' };

export function applyGfxIni(ini: Ini, g: Graphics): Ini {
  setIni(ini, 'Settings', {
    InternalResolution: String(g.resolutionScale),
    AspectRatio: ASPECT[g.aspect],
    ShowFPS: g.showFps ? 'True' : 'False',
  });
  setIni(ini, 'Hardware', { VSync: g.vsync ? 'True' : 'False' });
  return ini;
}
