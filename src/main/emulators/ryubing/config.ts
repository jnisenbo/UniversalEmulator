import { resolveButton, type PadButton } from '@shared/controls';
import { isPlainObject } from '@shared/merge';
import type { ControllerProfile, Graphics } from '@shared/settings';
import { sdlName } from '../dolphin/config';

type Json = Record<string, unknown>;
const isObj = isPlainObject;

/**
 * Ryubing keys Arcadia owns. Only keys already present in the user's
 * Config.json are changed, so a Ryubing update that renames a key degrades
 * to "not applied" instead of writing a field Ryubing doesn't understand.
 */
const TOP_LEVEL: Json = {
  start_fullscreen: true,
  show_confirm_exit: false,
  check_updates_on_start: false,
};

/** Ryubing's GamepadButtonInputId names (SDL GameController positions). */
const RYU_ID: Record<PadButton, string> = {
  south: 'A', east: 'B', west: 'X', north: 'Y',
  l1: 'LeftShoulder', r1: 'RightShoulder', l2: 'LeftTrigger', r2: 'RightTrigger',
  create: 'Minus', options: 'Plus', l3: 'LeftStick', r3: 'RightStick',
  up: 'DpadUp', down: 'DpadDown', left: 'DpadLeft', right: 'DpadRight',
  touchpad: 'Touchpad',
};

/** Switch buttons by position (see CONSOLE_BUTTONS.switch): Switch A is the right face button. */
const LEFT_JOYCON: Record<string, PadButton> = {
  button_minus: 'create', button_l: 'l1', button_zl: 'l2',
  dpad_up: 'up', dpad_down: 'down', dpad_left: 'left', dpad_right: 'right',
};
const RIGHT_JOYCON: Record<string, PadButton> = {
  button_plus: 'options', button_r: 'r1', button_zr: 'r2',
  button_a: 'east', button_b: 'south', button_x: 'north', button_y: 'west',
};
const STICK_BUTTON: Record<string, PadButton> = { left_joycon_stick: 'l3', right_joycon_stick: 'r3' };

const ASPECT: Record<Graphics['aspect'], string> = { auto: 'Fixed16x9', '16:9': 'Fixed16x9', '4:3': 'Fixed4x3', stretch: 'Stretched' };

export interface PatchResult {
  config: Json;
  controllersUpdated: number;
  missingKeys: string[];
}

export function patchRyubingConfig(source: Json, p: ControllerProfile, g?: Graphics): PatchResult {
  const config: Json = structuredClone(source);
  const missingKeys: string[] = [];
  const setIfPresent = (k: string, v: unknown, required = true): void => {
    if (k in config) config[k] = v;
    else if (required) missingKeys.push(k);
  };
  for (const [k, v] of Object.entries(TOP_LEVEL)) setIfPresent(k, v);

  if (g) {
    setIfPresent('res_scale', g.resolutionScale);
    setIfPresent('aspect_ratio', ASPECT[g.aspect]);
    // Older builds: enable_vsync (bool). Newer: vsync_mode ("Switch" = 60 Hz cap, "Unbounded").
    if ('vsync_mode' in config) config.vsync_mode = g.vsync ? 'Switch' : 'Unbounded';
    else setIfPresent('enable_vsync', g.vsync);
  }

  const id = (slot: PadButton): string => RYU_ID[resolveButton(p.layout, slot)];
  let controllersUpdated = 0;
  const inputs = Array.isArray(config.input_config) ? config.input_config : [];
  for (const input of inputs) {
    // The controller's `id` comes from SDL's GUID and can't be derived here, so
    // Arcadia only tunes controllers the user has already selected in Ryubing once.
    if (!isObj(input) || typeof input.backend !== 'string' || !input.backend.startsWith('Gamepad')) continue;
    Object.assign(input, {
      deadzone_left: p.deadzoneLeft,
      deadzone_right: p.deadzoneRight,
      range_left: p.rangeLeft,
      range_right: p.rangeRight,
      trigger_threshold: p.triggerThreshold,
    });
    for (const [side, table] of [['left_joycon', LEFT_JOYCON], ['right_joycon', RIGHT_JOYCON]] as const) {
      const joycon = input[side];
      if (isObj(joycon)) for (const [key, slot] of Object.entries(table)) joycon[key] = id(slot);
    }
    for (const [stickKey, slot] of Object.entries(STICK_BUTTON)) {
      const stick = input[stickKey];
      if (isObj(stick)) stick.stick_button = id(slot);
    }
    if (isObj(input.rumble)) input.rumble.enable_rumble = p.rumble;
    if (isObj(input.motion)) input.motion.enable_motion = p.motion;
    controllersUpdated++;
  }
  return { config, controllersUpdated, missingKeys };
}

const PLAYER_SLOTS = ['Player1', 'Player2', 'Player3', 'Player4'];

export interface PlayersResult {
  added: number;
  /** Controller models connected now that Ryubing has never been set up with. */
  needsSetup: string[];
}

/**
 * Local multiplayer. Ryubing names a controller "<n>-<SDL GUID>", where n counts
 * controllers of the same model. So once one DualSense is set up, a second one
 * is "1-<same GUID>": Arcadia adds it as the next player with the same mapping.
 * A model Ryubing has never seen (different GUID) has to be picked in Ryubing once.
 */
export function addRyubingPlayers(config: Json, controllers: { name: string }[], multiplayer: boolean): PlayersResult {
  const result: PlayersResult = { added: 0, needsSetup: [] };
  if (!multiplayer || controllers.length < 2 || !Array.isArray(config.input_config)) return result;
  const inputs = config.input_config as unknown[];
  const pads = inputs.filter((i): i is Json => isObj(i) && typeof i.backend === 'string' && i.backend.startsWith('Gamepad') && typeof i.id === 'string');
  const used = new Set(inputs.map((i) => (isObj(i) ? i.player_index : undefined)));
  const modelOf = (name: unknown): string => sdlName(typeof name === 'string' ? name.replace(/\s*\(\d+\)\s*$/, '') : '').toLowerCase();

  const wanted = new Map<string, { label: string; count: number }>();
  for (const c of controllers.slice(0, PLAYER_SLOTS.length)) {
    const key = modelOf(c.name);
    wanted.set(key, { label: sdlName(c.name), count: (wanted.get(key)?.count ?? 0) + 1 });
  }

  for (const [model, { label, count }] of wanted) {
    const mine = pads.filter((p) => modelOf(p.name) === model);
    const template = mine[0];
    const guid = template ? /^\d+-(.+)$/.exec(template.id as string)?.[1] : undefined;
    if (!template || !guid) {
      result.needsSetup.push(label);
      continue;
    }
    const ids = new Set(mine.map((p) => p.id));
    for (let n = 0; n < count; n++) {
      const id = `${n}-${guid}`;
      if (ids.has(id)) continue;
      const slot = PLAYER_SLOTS.find((s) => !used.has(s));
      if (!slot) return result;
      inputs.push({ ...structuredClone(template), id, player_index: slot });
      used.add(slot);
      result.added++;
    }
  }
  return result;
}
