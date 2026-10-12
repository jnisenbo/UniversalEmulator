import { resolveButton, type PadButton } from '@shared/controls';
import type { ControllerProfile, Graphics } from '@shared/settings';

type Toml = Record<string, unknown>;
const isObj = (v: unknown): v is Toml => typeof v === 'object' && v !== null && !Array.isArray(v);

function table(root: Toml, path: string[]): Toml {
  let t = root;
  for (const key of path) {
    if (!isObj(t[key])) t[key] = {};
    t = t[key] as Toml;
  }
  return t;
}

/**
 * xemu's controller_mapping stores, for each Xbox control, the SDL
 * GameController button index that drives it (config_spec.yml).
 */
const SDL_BUTTON: Partial<Record<PadButton, number>> = {
  south: 0, east: 1, west: 2, north: 3,
  create: 4, options: 6, l3: 7, r3: 8, l1: 9, r1: 10,
  up: 11, down: 12, left: 13, right: 14, touchpad: 20,
};
const SDL_TRIGGER_AXIS: Partial<Record<PadButton, number>> = { l2: 4, r2: 5 };

/** Xbox controls by position (see CONSOLE_BUTTONS.xbox). White/Black sit on L/R. */
const XBOX_BUTTONS: Record<string, PadButton> = {
  a: 'south', b: 'east', x: 'west', y: 'north',
  back: 'create', start: 'options', lstick_btn: 'l3', rstick_btn: 'r3',
  lshoulder: 'l1', rshoulder: 'r1',
  dpad_up: 'up', dpad_down: 'down', dpad_left: 'left', dpad_right: 'right',
};

const FIT: Record<Graphics['aspect'], { fit: string; aspect_ratio: string }> = {
  auto: { fit: 'scale', aspect_ratio: 'auto' },
  '16:9': { fit: 'scale', aspect_ratio: '16x9' },
  '4:3': { fit: 'scale', aspect_ratio: '4x3' },
  stretch: { fit: 'stretch', aspect_ratio: 'auto' },
};

export interface XemuPatch {
  config: Toml;
  mappingsUpdated: number;
  missingFiles: string[];
  skippedButtons: PadButton[];
}

/**
 * Patch a copy of the user's xemu.toml. BIOS, flash, EEPROM and HDD paths
 * come from the user's own config and are only checked, never changed.
 */
export function patchXemuConfig(source: Toml, p: ControllerProfile, g: Graphics): XemuPatch {
  const config = structuredClone(source);
  table(config, ['general']).show_welcome = false;
  table(config, ['general', 'updates']).check = false;
  table(config, ['display', 'window']).fullscreen_on_startup = true;
  table(config, ['display', 'window']).vsync = g.vsync;
  table(config, ['display', 'quality']).surface_scale = g.resolutionScale;
  Object.assign(table(config, ['display', 'ui']), FIT[g.aspect], { show_menubar: false, hide_cursor: true });
  table(config, ['input']).auto_bind = true;

  const files = table(config, ['sys', 'files']);
  const missingFiles = ['bootrom_path', 'flashrom_path', 'hdd_path'].filter((k) => typeof files[k] !== 'string' || !files[k]);

  // Mappings are keyed by the controller's SDL GUID, which only xemu knows, so
  // Arcadia updates entries xemu has already created for a connected controller.
  const skippedButtons = new Set<PadButton>();
  let mappingsUpdated = 0;
  const mappings = (config.input as Toml | undefined)?.gamepad_mappings;
  if (Array.isArray(mappings)) {
    for (const m of mappings) {
      if (!isObj(m)) continue;
      const cm = isObj(m.controller_mapping) ? m.controller_mapping : (m.controller_mapping = {});
      for (const [key, slot] of Object.entries(XBOX_BUTTONS)) {
        const physical = resolveButton(p.layout, slot);
        const idx = SDL_BUTTON[physical];
        if (idx === undefined) skippedButtons.add(slot); // e.g. a trigger can't drive a digital button in xemu
        else (cm as Toml)[key] = idx;
      }
      for (const [key, slot] of [['axis_trigger_left', 'l2'], ['axis_trigger_right', 'r2']] as const) {
        const axis = SDL_TRIGGER_AXIS[resolveButton(p.layout, slot)];
        if (axis === undefined) skippedButtons.add(slot);
        else (cm as Toml)[key] = axis;
      }
      m.enable_rumble = p.rumble;
      mappingsUpdated++;
    }
  }
  return { config, mappingsUpdated, missingFiles, skippedButtons: [...skippedButtons] };
}
