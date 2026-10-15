export const PLATFORMS = ['wii', 'gamecube', 'switch', 'xbox', 'xbox360', 'ps2', 'ps3', 'ps1', 'n64', 'snes', 'nes', 'gba', 'gb', 'genesis', 'mac'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const EMULATOR_IDS = ['dolphin', 'ryubing', 'xemu', 'xenia', 'pcsx2', 'rpcs3', 'retroarch'] as const;
export type EmulatorId = (typeof EMULATOR_IDS)[number];
/** What runs a game: an emulator, or the Mac itself for native games. */
export type RunnerId = EmulatorId | 'native';

export interface PlatformInfo {
  label: string;
  short: string;
  emulator: RunnerId;
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
  ps2: { label: 'PlayStation 2', short: 'PS2', emulator: 'pcsx2', hue: 225 },
  ps3: { label: 'PlayStation 3', short: 'PS3', emulator: 'rpcs3', hue: 240 },
  ps1: { label: 'PlayStation', short: 'PS1', emulator: 'retroarch', hue: 215 },
  n64: { label: 'Nintendo 64', short: 'N64', emulator: 'retroarch', hue: 30 },
  snes: { label: 'Super Nintendo', short: 'SNES', emulator: 'retroarch', hue: 280 },
  nes: { label: 'NES', short: 'NES', emulator: 'retroarch', hue: 0 },
  gba: { label: 'Game Boy Advance', short: 'GBA', emulator: 'retroarch', hue: 250 },
  gb: { label: 'Game Boy', short: 'GB', emulator: 'retroarch', hue: 90 },
  genesis: { label: 'Genesis', short: 'MD', emulator: 'retroarch', hue: 10 },
  mac: { label: 'Mac', short: 'Mac', emulator: 'native', hue: 210 },
};

export const EMULATOR_LABEL: Record<RunnerId, string> = {
  native: 'Mac app',
  dolphin: 'Dolphin',
  ryubing: 'Ryubing',
  xemu: 'xemu',
  xenia: 'Xenia / XeniOS',
  pcsx2: 'PCSX2',
  rpcs3: 'RPCS3',
  retroarch: 'RetroArch',
};
