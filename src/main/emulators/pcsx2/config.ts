import { resolveButton, type PadButton } from '@shared/controls';
import type { ControllerProfile } from '@shared/settings';
import { setIni, type Ini } from '../../util/ini';

/** PCSX2's SDL binding names (what its "Automatic Mapping" writes). */
const SDL: Record<PadButton, string | null> = {
  south: 'FaceSouth', east: 'FaceEast', west: 'FaceWest', north: 'FaceNorth',
  l1: 'LeftShoulder', r1: 'RightShoulder', l2: '+LeftTrigger', r2: '+RightTrigger',
  create: 'Back', options: 'Start', l3: 'LeftStick', r3: 'RightStick',
  up: 'DPadUp', down: 'DPadDown', left: 'DPadLeft', right: 'DPadRight',
  touchpad: null,
};

/** DualShock 2 button → Arcadia slot (positional, like the PS5 controller). */
const DS2: Record<string, PadButton> = {
  Cross: 'south', Circle: 'east', Square: 'west', Triangle: 'north',
  L1: 'l1', R1: 'r1', L2: 'l2', R2: 'r2', Select: 'create', Start: 'options', L3: 'l3', R3: 'r3',
  Up: 'up', Down: 'down', Left: 'left', Right: 'right',
};

/** Bindings for one DualShock 2 on SDL controller `index`. */
export function pcsx2Pad(p: ControllerProfile, index: number): Record<string, string> {
  const dev = `SDL-${index}`;
  const out: Record<string, string> = { Type: 'DualShock2' };
  for (const [ds2, slot] of Object.entries(DS2)) {
    const name = SDL[resolveButton(p.layout, slot)];
    if (name) out[ds2] = `${dev}/${name}`;
  }
  Object.assign(out, {
    LUp: `${dev}/-LeftY`, LDown: `${dev}/+LeftY`, LLeft: `${dev}/-LeftX`, LRight: `${dev}/+LeftX`,
    RUp: `${dev}/-RightY`, RDown: `${dev}/+RightY`, RLeft: `${dev}/-RightX`, RRight: `${dev}/+RightX`,
    Analog: `${dev}/Guide`,
    Deadzone: p.deadzoneLeft.toFixed(2),
    LargeMotor: p.rumble ? `${dev}/LargeMotor` : '',
    SmallMotor: p.rumble ? `${dev}/SmallMotor` : '',
  });
  return out;
}

/**
 * Patch the user's PCSX2.ini: controllers for up to 2 players (the PS2 has two
 * ports) on SDL, fullscreen without the confirm-on-quit prompt. Everything else is kept.
 */
export function patchPcsx2Ini(ini: Ini, p: ControllerProfile, players: number): Ini {
  setIni(ini, 'InputSources', { SDL: 'true' });
  for (let n = 1; n <= Math.min(2, Math.max(1, players)); n++) setIni(ini, `Pad${n}`, pcsx2Pad(p, n - 1));
  setIni(ini, 'UI', { ConfirmShutdown: 'false' });
  return ini;
}

/** The BIOS PCSX2 is set to use, or null if setup hasn't been finished. */
export const pcsx2Bios = (ini: Ini): string | null => ini.get('Filenames')?.get('BIOS')?.trim() || null;
