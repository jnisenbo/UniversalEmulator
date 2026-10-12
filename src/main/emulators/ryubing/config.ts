import type { ControllerProfile } from '@shared/settings';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

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

/**
 * Switch buttons by position: Switch A is the right face button, so it maps
 * to SDL "B" (east). Matches Ryubing's own defaults.
 */
const LEFT_JOYCON = {
  button_minus: 'Minus',
  button_l: 'LeftShoulder',
  button_zl: 'LeftTrigger',
  dpad_up: 'DpadUp',
  dpad_down: 'DpadDown',
  dpad_left: 'DpadLeft',
  dpad_right: 'DpadRight',
};
const RIGHT_JOYCON = {
  button_plus: 'Plus',
  button_r: 'RightShoulder',
  button_zr: 'RightTrigger',
  button_a: 'B',
  button_b: 'A',
  button_x: 'Y',
  button_y: 'X',
};

export interface PatchResult {
  config: Json;
  controllersUpdated: number;
  missingKeys: string[];
}

export function patchRyubingConfig(source: Json, p: ControllerProfile): PatchResult {
  const config: Json = structuredClone(source);
  const missingKeys: string[] = [];
  for (const [k, v] of Object.entries(TOP_LEVEL)) {
    if (k in config) config[k] = v;
    else missingKeys.push(k);
  }

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
    if (isObj(input.left_joycon)) Object.assign(input.left_joycon, LEFT_JOYCON);
    if (isObj(input.right_joycon)) Object.assign(input.right_joycon, RIGHT_JOYCON);
    if (isObj(input.rumble)) input.rumble.enable_rumble = p.rumble;
    if (isObj(input.motion)) input.motion.enable_motion = p.motion;
    controllersUpdated++;
  }
  return { config, controllersUpdated, missingKeys };
}
