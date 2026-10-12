export const PLATFORMS = ['wii', 'gamecube', 'switch', 'xbox', 'xbox360'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const EMULATOR_IDS = ['dolphin', 'ryubing', 'xemu', 'xenia'] as const;
export type EmulatorId = (typeof EMULATOR_IDS)[number];

export interface PlatformInfo {
  label: string;
  short: string;
  emulator: EmulatorId;
  /** Accent used for placeholder art. Hue in degrees. */
  hue: number;
  experimental?: boolean;
}

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  wii: { label: 'Wii', short: 'Wii', emulator: 'dolphin', hue: 200 },
  gamecube: { label: 'GameCube', short: 'GC', emulator: 'dolphin', hue: 262 },
  switch: { label: 'Switch', short: 'Switch', emulator: 'ryubing', hue: 352 },
  xbox: { label: 'Xbox', short: 'Xbox', emulator: 'xemu', hue: 140 },
  xbox360: { label: 'Xbox 360', short: '360', emulator: 'xenia', hue: 110, experimental: true },
};

export const EMULATOR_LABEL: Record<EmulatorId, string> = {
  dolphin: 'Dolphin',
  ryubing: 'Ryubing',
  xemu: 'xemu',
  xenia: 'Xenia / XeniOS',
};
