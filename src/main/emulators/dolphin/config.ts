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
export function gcPadIni(p: ControllerProfile, devices: string[] = [p.dolphinDevice]): Ini {
  const ini: Ini = new Map();
  for (const n of [1, 2, 3, 4]) {
    const device = devices[n - 1];
    if (!device) {
      setIni(ini, `GCPad${n}`, { Device: devices[0] ?? p.dolphinDevice });
      continue;
    }
    setIni(ini, `GCPad${n}`, {
      Device: device,
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
  }
  return ini;
}

/**
 * Wii Remote + Nunchuk (see CONSOLE_BUTTONS.wii). Pointer on the right stick;
 * controller gyro/accelerometer drive Wii motion. Home is on the touchpad
 * because the controller's Home button opens Arcadia's in-game menu.
 */
export function wiimoteIni(p: ControllerProfile, devices: string[] = [p.dolphinDevice], gameId?: string | null): Ini {
  const ini: Ini = new Map();
  const preset = gameId ? WII_PRESETS[gameId.slice(0, 3).toUpperCase()] : undefined;
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
  const wiimote = (device: string): Record<string, string> => ({
    Device: device,
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
  for (const n of [1, 2, 3, 4]) {
    const device = devices[n - 1];
    setIni(ini, `Wiimote${n}`, device ? (preset ? preset.build(p, device) : wiimote(device)) : { Source: '0' });
  }
  setIni(ini, 'BalanceBoard', { Source: '0' });
  return ini;
}

/**
 * Wii games whose controls don't fit the general layout get their own,
 * keyed by the first three characters of the disc ID (any region).
 */
export interface WiiPreset {
  build(p: ControllerProfile, device: string): Record<string, string>;
}

const shake = (prefix: string, value: string): Record<string, string> => ({ [`${prefix}/X`]: value, [`${prefix}/Y`]: value, [`${prefix}/Z`]: value });

/**
 * The Legend of Zelda: Twilight Princess (Wii). Every motion gets a button:
 * sword (shake Wii Remote), spin attack (shake Nunchuk) and shield attack
 * (thrust Nunchuk forward). Motion sensing is off so moving the controller
 * never swings the sword by accident. The right stick aims, R3 recenters it.
 */
/** Shown to you in the game's Options menu: @shared/presets WII_PRESET_INFO.RZD. */
const TWILIGHT_PRINCESS: WiiPreset = {
  build: (p, device) => ({
    Device: device,
    Source: '1',
    'Buttons/A': bind(p, 'south'),
    'Buttons/B': bind(p, 'r2'),
    'Buttons/1': bind(p, 'r1'),
    'Buttons/2': bind(p, 'touchpad'),
    'Buttons/-': bind(p, 'create'),
    'Buttons/+': bind(p, 'options'),
    'Buttons/Home': '',
    ...dpad('D-Pad', p),
    'IR/Up': q('Right Y+'),
    'IR/Down': q('Right Y-'),
    'IR/Left': q('Right X-'),
    'IR/Right': q('Right X+'),
    'IR/Dead Zone': pct(p.deadzoneRight),
    'IR/Relative Input': 'True',
    'IR/Recenter': bind(p, 'r3'),
    ...shake('Shake', bind(p, 'west')),
    Extension: 'Nunchuk',
    'Nunchuk/Buttons/C': bind(p, 'l1'),
    'Nunchuk/Buttons/Z': bind(p, 'l2'),
    ...stick('Nunchuk/Stick', 'Left', p.deadzoneLeft),
    ...shake('Nunchuk/Shake', bind(p, 'east')),
    'Nunchuk/Swing/Forward': bind(p, 'north'),
    'Rumble/Motor': rumble(p),
  }),
};

export const WII_PRESETS: Record<string, WiiPreset> = {
  RZD: TWILIGHT_PRINCESS,
};

/** Keys Arcadia owns in Dolphin.ini. Everything else the user sets in Dolphin is kept. */
export function applyDolphinIni(ini: Ini, players = 1): Ini {
  setIni(ini, 'Display', { Fullscreen: 'True' });
  // Pausing when focus leaves Dolphin means the in-game menu (Home) pauses the game.
  setIni(ini, 'Interface', { ConfirmStop: 'False', PauseOnFocusLost: 'True' });
  setIni(ini, 'Analytics', { PermissionAsked: 'True', Enabled: 'False' });
  // 6 = standard GameCube controller. AutoDiscChange swaps discs from an .m3u when the game asks.
  setIni(ini, 'Core', {
    SIDevice0: '6',
    SIDevice1: players >= 2 ? '6' : '0',
    SIDevice2: players >= 3 ? '6' : '0',
    SIDevice3: players >= 4 ? '6' : '0',
    AutoDiscChange: 'True',
  });
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
    // 2 = Hybrid Ubershaders: no hitch the first time an effect is drawn.
    // Dolphin's default (synchronous) pauses the game while each new shader compiles.
    ShaderCompilationMode: '2',
  });
  setIni(ini, 'Hardware', { VSync: g.vsync ? 'True' : 'False' });
  return ini;
}

/** Dolphin's SDL device string for a controller name ("Xbox Wireless Controller" etc.). */
const SDL_NAMES: [RegExp, string][] = [
  [/dualsense edge/i, 'DualSense Edge Wireless Controller'],
  [/dualsense/i, 'DualSense Wireless Controller'],
  [/xbox/i, 'Xbox Wireless Controller'],
  [/dualshock/i, 'PS4 Controller'],
];
export function sdlName(name: string): string {
  for (const [re, sdl] of SDL_NAMES) if (re.test(name)) return sdl;
  return name;
}

/**
 * Dolphin device per player, max 4. Dolphin numbers devices per name, so two
 * DualSense controllers are SDL/0/… and SDL/1/…, and an Xbox pad is its own SDL/0/….
 * Player 1 keeps the device chosen in Settings when it is connected.
 */
export function dolphinPlayers(p: ControllerProfile, controllers: { name: string }[] = []): string[] {
  if (!p.multiplayer) return [p.dolphinDevice];
  const manual = p.extraDevices.filter((d) => d.trim());
  if (manual.length) return [p.dolphinDevice, ...manual].slice(0, 4);
  const seen = new Map<string, number>();
  const connected = controllers.map((c) => {
    const name = sdlName(c.name);
    const i = seen.get(name) ?? 0;
    seen.set(name, i + 1);
    return `SDL/${i}/${name}`;
  });
  if (!connected.length) return [p.dolphinDevice];
  const first = connected.includes(p.dolphinDevice) ? p.dolphinDevice : connected[0]!;
  return [first, ...connected.filter((d) => d !== first)].slice(0, 4);
}
