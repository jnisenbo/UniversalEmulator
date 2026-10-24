import type { ControllerProfile } from './settings';

/** The name Dolphin and RPCS3 (SDL) most often give a controller. */
const SDL_NAMES: [RegExp, string][] = [
  [/dualsense edge/i, 'DualSense Edge Wireless Controller'],
  [/dualsense/i, 'DualSense Wireless Controller'],
  [/xbox/i, 'Xbox Wireless Controller'],
  [/dualshock/i, 'PS4 Controller'],
];
export function sdlName(name: string): string {
  for (const [re, sdl] of SDL_NAMES) if (re.test(name)) return sdl;
  return name;
}

/** Every name a controller of this kind is known to appear under in SDL. */
const ALIASES: [RegExp, string[]][] = [
  [/dualsense edge/i, ['DualSense Edge Wireless Controller', 'PS5 Controller', 'DualSense Wireless Controller']],
  [/dualsense|ps5/i, ['DualSense Wireless Controller', 'PS5 Controller']],
  [/xbox/i, ['Xbox Wireless Controller', 'Xbox Series X Controller', 'Xbox One S Controller', 'Xbox One Controller', 'Xbox Controller']],
  [/dualshock|ps4/i, ['PS4 Controller', 'DUALSHOCK 4 Wireless Controller', 'Wireless Controller']],
];
export function nameCandidates(name: string): string[] {
  const alias = ALIASES.find(([re]) => re.test(name))?.[1] ?? [];
  return [...new Set([name, ...alias])];
}

/**
 * Dolphin device per player, max 4. Dolphin numbers devices per name, so two
 * DualSense controllers are SDL/0/… and SDL/1/…, and an Xbox pad is its own SDL/0/….
 * Player 1 keeps the device chosen in Settings when it is connected; the rest
 * follow in the order macOS lists them (the order they connected).
 */
export function dolphinPlayers(p: ControllerProfile, controllers: { name: string }[] = []): string[] {
  if (!p.multiplayer) return [p.dolphinDevice];
  const manual = p.extraDevices.filter((d) => d.trim());
  if (manual.length) return [p.dolphinDevice, ...manual].slice(0, 4);
  const connected = playerDevices(controllers);
  if (!connected.length) return [p.dolphinDevice];
  const first = connected.includes(p.dolphinDevice) ? p.dolphinDevice : connected[0]!;
  return [first, ...connected.filter((d) => d !== first)].slice(0, 4);
}

function playerDevices(controllers: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return controllers.map((c) => {
    const name = sdlName(c.name);
    const i = seen.get(name) ?? 0;
    seen.set(name, i + 1);
    return `SDL/${i}/${name}`;
  });
}

/** For the controller screen: which connected controller is which player (indexes into `controllers`). */
export function playerOrder(p: ControllerProfile, controllers: { name: string }[]): number[] {
  const devices = playerDevices(controllers);
  return dolphinPlayers(p, controllers)
    .map((d) => devices.indexOf(d))
    .filter((i) => i >= 0);
}
