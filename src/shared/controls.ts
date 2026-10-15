import type { Platform } from './platforms';

/**
 * Physical controls on the controller, named by position so they read the
 * same on any modern pad. Indices follow the W3C "standard" Gamepad mapping
 * (which is also SDL's GameController order for the face buttons).
 */
export const PAD_BUTTONS = [
  'south', 'east', 'west', 'north',
  'l1', 'r1', 'l2', 'r2',
  'create', 'options', 'l3', 'r3',
  'up', 'down', 'left', 'right',
  'touchpad',
] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];

export const PAD_INDEX: Record<PadButton, number> = {
  south: 0, east: 1, west: 2, north: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  create: 8, options: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
  touchpad: 17,
};

export const PAD_LABEL: Record<PadButton, string> = {
  south: 'Bottom button',
  east: 'Right button',
  west: 'Left button',
  north: 'Top button',
  l1: 'L',
  r1: 'R',
  l2: 'L trigger',
  r2: 'R trigger',
  create: 'Create',
  options: 'Options',
  l3: 'Left stick press',
  r3: 'Right stick press',
  up: 'D-pad up',
  down: 'D-pad down',
  left: 'D-pad left',
  right: 'D-pad right',
  touchpad: 'Touchpad press',
};

/**
 * A layout says which physical control drives each slot. Slots are the
 * "positions" every emulator adapter maps from, so one layout applies to all
 * emulators. Only changed slots are stored; missing = same position.
 */
export type ButtonLayout = Partial<Record<PadButton, PadButton>>;

export const resolveButton = (layout: ButtonLayout, slot: PadButton): PadButton => layout[slot] ?? slot;

/** Assign `physical` to `slot`, swapping with whichever slot had it, so the layout stays one-to-one. */
export function assignButton(layout: ButtonLayout, slot: PadButton, physical: PadButton): ButtonLayout {
  const next: Partial<Record<PadButton, PadButton>> = {};
  for (const s of PAD_BUTTONS) next[s] = resolveButton(layout, s);
  const holder = PAD_BUTTONS.find((s) => next[s] === physical);
  if (holder && holder !== slot) next[holder] = next[slot];
  next[slot] = physical;
  return compactLayout(next);
}

export function compactLayout(layout: ButtonLayout): ButtonLayout {
  const out: ButtonLayout = {};
  for (const s of PAD_BUTTONS) if (layout[s] && layout[s] !== s) out[s] = layout[s];
  return out;
}

export const LAYOUT_PRESETS: { id: string; label: string; detail: string; layout: ButtonLayout }[] = [
  { id: 'position', label: 'By position', detail: 'Each console button sits where it does on that console (default)', layout: {} },
  {
    id: 'swap-face',
    label: 'Swap face buttons',
    detail: 'Bottom↔Right and Left↔Top, e.g. Switch A on the bottom button',
    layout: { south: 'east', east: 'south', west: 'north', north: 'west' },
  },
  {
    id: 'shoulders-triggers',
    label: 'Swap shoulders and triggers',
    detail: 'L↔L trigger and R↔R trigger',
    layout: { l1: 'l2', l2: 'l1', r1: 'r2', r2: 'r1' },
  },
];

/**
 * What each slot does on each console with Arcadia's default mapping.
 * The UI shows this next to each slot; the emulator adapters are written
 * against the same slot names.
 */
export const CONSOLE_BUTTONS: Record<Platform, Partial<Record<PadButton, string>>> = {
  gamecube: { south: 'A', west: 'B', east: 'X', north: 'Y', r1: 'Z', l2: 'L', r2: 'R', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  wii: { south: 'A', r2: 'B', west: '1', north: '2', create: '−', options: '+', touchpad: 'Home', l1: 'C', l2: 'Z', east: 'Shake', l3: 'Nunchuk shake', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  switch: { east: 'A', south: 'B', north: 'X', west: 'Y', l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR', create: '−', options: '+', l3: 'L stick', r3: 'R stick', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', l1: 'White', r1: 'Black', l2: 'L', r2: 'R', create: 'Back', options: 'Start', l3: 'L stick', r3: 'R stick', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  xbox360: { south: 'A', east: 'B', west: 'X', north: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', create: 'Back', options: 'Start', l3: 'LS', r3: 'RS', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  ps2: { south: 'Cross', east: 'Circle', west: 'Square', north: 'Triangle', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', create: 'Select', options: 'Start', l3: 'L3', r3: 'R3', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  ps3: { south: 'Cross', east: 'Circle', west: 'Square', north: 'Triangle', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', create: 'Select', options: 'Start', l3: 'L3', r3: 'R3', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  ps1: { south: 'Cross', east: 'Circle', west: 'Square', north: 'Triangle', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', create: 'Select', options: 'Start', l3: 'L3', r3: 'R3', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  n64: { south: 'A', west: 'B', l1: 'L', r1: 'R', l2: 'Z', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  snes: { east: 'A', south: 'B', north: 'X', west: 'Y', l1: 'L', r1: 'R', create: 'Select', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  nes: { east: 'A', south: 'B', create: 'Select', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  gba: { east: 'A', south: 'B', l1: 'L', r1: 'R', create: 'Select', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  gb: { east: 'A', south: 'B', create: 'Select', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  genesis: { south: 'A', east: 'B', r1: 'C', west: 'X', north: 'Y', l1: 'Z', options: 'Start', up: 'D-pad', down: 'D-pad', left: 'D-pad', right: 'D-pad' },
  mac: {},
};

/** Which platforms' emulators honour the layout (Xenia has no remapping). */
export const LAYOUT_SUPPORTED: Record<Platform, boolean> = {
  gamecube: true, wii: true, switch: true, xbox: true, xbox360: false,
  // PCSX2 gets the standard layout written for you; RPCS3 and RetroArch use their own mapping.
  ps2: false, ps3: false, ps1: false, n64: false, snes: false, nes: false, gba: false, gb: false, genesis: false,
  // Mac games read the controller themselves.
  mac: false,
};
