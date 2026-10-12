import { z } from 'zod';

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
  /** Device string Dolphin uses, e.g. "SDL/0/DualSense Wireless Controller". */
  dolphinDevice: z.string().default('SDL/0/DualSense Wireless Controller'),
});
export type ControllerProfile = z.infer<typeof ControllerProfileSchema>;

const app = z.string().nullable().default(null);

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  libraryFolders: z.array(z.string()).default([]),
  emulators: z
    .object({
      dolphin: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      ryubing: z.object({ appPath: app, dataDir: z.string().nullable().default(null) }).prefault({}),
      xenia: z
        .object({ appPath: app, argsTemplate: z.string().default('{game} --fullscreen=true') })
        .prefault({}),
    })
    .prefault({}),
  /** Your own prod.keys, read-only, used to identify Switch dumps. Never copied. */
  switchKeysPath: z.string().nullable().default(null),
  controller: ControllerProfileSchema.prefault({}),
  ui: z
    .object({
      sounds: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(0.5),
      backgroundDrift: z.boolean().default(false),
    })
    .prefault({}),
  /** Global keyboard shortcut that quits the running game back to Arcadia. */
  quitShortcut: z.string().default('Command+Shift+Escape'),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** One level deep: top-level keys, and the fields of nested objects. */
export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends unknown[] | string | number | boolean | null
    ? Settings[K]
    : DeepPartial<Settings[K]>;
};
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export const defaultSettings = (): Settings => SettingsSchema.parse({});
