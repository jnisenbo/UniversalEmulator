import { z } from 'zod';
import { PAD_BUTTONS } from './controls';
import { PLATFORMS } from './platforms';

const rgb = z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) });

export const ControllerProfileSchema = z.object({
  /** Fractions 0..0.5 of full stick travel ignored around center. */
  deadzoneLeft: z.number().min(0).max(0.5).default(0.1),
  deadzoneRight: z.number().min(0).max(0.5).default(0.1),
  /** Fraction of travel that counts as full deflection (outer deadzone). */
  rangeLeft: z.number().min(0.5).max(1).default(1),
  rangeRight: z.number().min(0.5).max(1).default(1),
  /** Trigger travel that counts as a digital press. */
  triggerThreshold: z.number().min(0.05).max(0.95).default(0.5),
  rumble: z.boolean().default(true),
  motion: z.boolean().default(true),
  lightBar: rgb.default({ r: 64, g: 120, b: 255 }),
  /** Slot → physical button overrides, shared by every emulator. */
  layout: z.partialRecord(z.enum(PAD_BUTTONS), z.enum(PAD_BUTTONS)).default({}),
  /** Device string Dolphin uses, e.g. "SDL/0/DualSense Wireless Controller". */
  dolphinDevice: z.string().default('SDL/0/DualSense Wireless Controller'),
  /** Every connected controller becomes the next player (GameCube and Wii, up to 4). */
  multiplayer: z.boolean().default(true),
  /** Manual Dolphin device strings for players 2 to 4. Empty = assign automatically. */
  extraDevices: z.array(z.string()).max(3).default([]),
});
export type ControllerProfile = z.infer<typeof ControllerProfileSchema>;

const app = z.string().nullable().default(null);

/** Field shapes shared by the global settings and per-game overrides. */
const graphicsFields = {
  /** Internal resolution as a multiple of the console's native output. */
  resolutionScale: z.number().int().min(1).max(4),
  vsync: z.boolean(),
  aspect: z.enum(['auto', '16:9', '4:3', 'stretch']),
  showFps: z.boolean(),
};

export const GraphicsSchema = z.object({
  resolutionScale: graphicsFields.resolutionScale.default(2),
  vsync: graphicsFields.vsync.default(true),
  aspect: graphicsFields.aspect.default('auto'),
  showFps: graphicsFields.showFps.default(false),
});
export type Graphics = z.infer<typeof GraphicsSchema>;

/** Per-game override: only the fields set for that game, no defaults filled in. */
export const GraphicsOverrideSchema = z.object(graphicsFields).partial();

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  libraryFolders: z.array(z.string()).default([]),
  /** Mac game apps added one by one (game apps inside library folders are found automatically). */
  macGames: z.array(z.string()).default([]),
  /** List installed Steam games that have a Mac version, launched through Steam. */
  steamImport: z.boolean().default(true),
  saves: z
    .object({
      /** Copy every emulator's saves to one folder after each game. */
      backup: z.boolean().default(true),
      /** Backup folder; null = iCloud Drive/Arcadia Saves (or Documents if iCloud Drive is off). */
      folder: z.string().nullable().default(null),
    })
    .prefault({}),
  emulators: z
    .object({
      dolphin: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      ryubing: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      xemu: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      xenia: z
        .object({ appPath: app, argsTemplate: z.string().default('{game} --fullscreen=true') })
        .prefault({}),
      pcsx2: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      rpcs3: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      retroarch: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
    })
    .prefault({}),
  /**
   * Any console can use another emulator app instead of the built-in one
   * (for example a different Switch emulator). Arcadia just launches it with
   * the argument template; {game} is replaced by the game's path.
   */
  customEmulators: z
    .partialRecord(
      z.enum(PLATFORMS),
      z.object({
        appPath: z.string(),
        name: z.string().default(''),
        argsTemplate: z.string().default('{game}'),
        /**
         * open: hand the game over like Finder does ("open this file"), which
         * native Mac apps such as Astris expect. args: start the app with the
         * argument template, for command-line emulators.
         */
        launch: z.enum(['open', 'args']).default('open'),
      }),
    )
    .default({}),
  /** Your own prod.keys, read-only, used to identify Switch dumps. Never copied. */
  switchKeysPath: z.string().nullable().default(null),
  controller: ControllerProfileSchema.prefault({}),
  graphics: GraphicsSchema.prefault({}),
  /** Per-game graphics overrides, keyed by gameKey(); missing fields use `graphics`. */
  gameGraphics: z.record(z.string(), GraphicsOverrideSchema).default({}),
  metadata: z
    .object({
      /** Your own SteamGridDB API key (steamgriddb.com → Preferences → API). */
      steamGridDbKey: z.string().nullable().default(null),
      autoFetch: z.boolean().default(true),
    })
    .prefault({}),
  ui: z
    .object({
      sounds: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(0.5),
      backgroundDrift: z.boolean().default(false),
      /** Interface size: standard for a laptop, large or TV for the couch. TV also keeps clear of the screen edges. */
      size: z.enum(['standard', 'large', 'tv']).default('standard'),
      sort: z.enum(['recent', 'title']).default('recent'),
      filter: z.enum(['all', ...PLATFORMS]).default('all'),
    })
    .prefault({}),
  /** Global keyboard shortcut that quits the running game back to Arcadia. */
  quitShortcut: z.string().default('Command+Shift+Escape'),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** A partial settings object; nested objects merge, arrays and map-like fields (button layout, per-game graphics) replace. */
export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends unknown[] | string | number | boolean | null
    ? Settings[K]
    : DeepPartial<Settings[K]>;
};
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export const defaultSettings = (): Settings => SettingsSchema.parse({});
