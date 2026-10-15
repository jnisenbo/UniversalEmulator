import { resolveButton, type PadButton } from '@shared/controls';
import type { ControllerProfile } from '@shared/settings';
import { sdlName } from '../dolphin/config';

/** RPCS3's SDL handler names (sdl_pad_handler.cpp button_list). */
const SDL: Record<PadButton, string> = {
  south: 'South', east: 'East', west: 'West', north: 'North',
  l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT',
  create: 'Back', options: 'Start', l3: 'LS', r3: 'RS',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  touchpad: 'Touchpad',
};

/** PS3 pad key (pad_config.h) → Arcadia slot, by position like the PS5 controller. */
const PS3: [string, PadButton][] = [
  ['Cross', 'south'], ['Circle', 'east'], ['Square', 'west'], ['Triangle', 'north'],
  ['L1', 'l1'], ['R1', 'r1'], ['L2', 'l2'], ['R2', 'r2'], ['L3', 'l3'], ['R3', 'r3'],
  ['Select', 'create'], ['Start', 'options'],
  ['Up', 'up'], ['Down', 'down'], ['Left', 'left'], ['Right', 'right'],
];

/** RPCS3 numbers SDL devices per name from 1: "DualSense Wireless Controller 1", "… 2". */
export function rpcs3Devices(p: ControllerProfile, controllers: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  const all = controllers.map((c) => {
    const name = sdlName(c.name);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
  if (!all.length) all.push('DualSense Wireless Controller 1');
  return (p.multiplayer ? all : all.slice(0, 1)).slice(0, 4);
}

const q = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** An RPCS3 input profile (YAML) with one SDL pad per connected controller, up to 4 players. */
export function rpcs3InputYaml(p: ControllerProfile, devices: string[]): string {
  const lines: string[] = [];
  for (let n = 1; n <= 7; n++) {
    const device = devices[n - 1];
    lines.push(`Player ${n} Input:`);
    if (!device) {
      lines.push('  Handler: "Null"', '  Device: ""', '  Buddy Device: ""');
      continue;
    }
    lines.push('  Handler: SDL', `  Device: ${q(device)}`, '  Config:');
    const map: [string, string][] = [
      ['Left Stick Left', 'LS X-'], ['Left Stick Down', 'LS Y-'], ['Left Stick Right', 'LS X+'], ['Left Stick Up', 'LS Y+'],
      ['Right Stick Left', 'RS X-'], ['Right Stick Down', 'RS Y-'], ['Right Stick Right', 'RS X+'], ['Right Stick Up', 'RS Y+'],
      ...PS3.map(([key, slot]): [string, string] => [key, SDL[resolveButton(p.layout, slot)]]),
      ['PS Button', 'Guide'],
    ];
    for (const [k, v] of map) lines.push(`    ${k}: ${q(v)}`);
    lines.push(
      `    Color Value R: ${p.lightBar.r}`,
      `    Color Value G: ${p.lightBar.g}`,
      `    Color Value B: ${p.lightBar.b}`,
      `    Large Vibration Motor Multiplier: ${p.rumble ? 100 : 0}`,
      `    Small Vibration Motor Multiplier: ${p.rumble ? 100 : 0}`,
    );
    lines.push('  Buddy Device: ""');
  }
  return lines.join('\n') + '\n';
}

/** Profile name passed to RPCS3 with --input-config. Your own "Default" profile is never touched. */
export const RPCS3_PROFILE = 'Arcadia';
