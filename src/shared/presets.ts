/**
 * Games with their own controller layout, keyed by the first three characters
 * of the disc ID (any region). The mappings live in each emulator's adapter;
 * this is what the library shows you.
 */
export interface PresetInfo {
  name: string;
  controls: string[];
}

export const WII_PRESET_INFO: Record<string, PresetInfo> = {
  RZD: {
    name: 'Twilight Princess',
    controls: [
      'Left stick: move · Right stick: aim (press R3 to recenter)',
      'Cross: A (action; with L2, roll and dodge) · Square: sword · Circle: spin attack · Triangle: shield attack (hold L2 on an enemy first)',
      'L2: Z (target, shield) · L1: C (look around) · R2: B (item) · R1: 1 (map) · Touchpad: 2 (mini map)',
      'D-pad: items, up calls Midna · Create: − (assign items) · Options: +',
    ],
  },
};

export const presetFor = (platform: string, gameId: string | null | undefined): PresetInfo | undefined =>
  platform === 'wii' && gameId ? WII_PRESET_INFO[gameId.slice(0, 3).toUpperCase()] : undefined;
