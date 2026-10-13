import type { EmulatorAdapter } from '../adapter';
import { detectApp } from '../status';

/** Splits a user-editable template like `{game} --fullscreen=true`, keeping {game} as one argument. */
export function expandArgs(template: string, gamePath: string): string[] {
  const tokens = template.match(/"[^"]*"|\S+/g) ?? [];
  const args = tokens.map((t) => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t)).map((t) => (t === '{game}' ? gamePath : t.replaceAll('{game}', () => gamePath)));
  return template.includes('{game}') ? args : [...args, gamePath];
}

/**
 * Xenia / XeniOS on Apple Silicon is experimental and its command line is still
 * moving, so launch arguments come from an editable template. Arcadia doesn't
 * write Xenia's config in Phase 1: it reads the DualSense as an Xbox pad natively.
 */
export const xeniaAdapter: EmulatorAdapter = {
  id: 'xenia',
  platforms: ['xbox360'],
  bundleNames: ['Xenia-edge.app', 'Xenia Edge.app', 'XeniOS.app', 'Xenia.app', 'xenia_canary.app', 'xenia.app'],

  installPath: (s) => s.emulators.xenia.appPath,

  async detect(ctx) {
    const { status } = await detectApp('xenia', ctx.settings.emulators.xenia.appPath);
    status.issues.push({ level: 'warn', message: 'Xbox 360 support is experimental. Many games will not boot or will run slowly.' });
    return status;
  },

  async writeConfig() {
    return { warnings: [] };
  },

  getLaunchArgs(game, app, ctx) {
    return { executable: app.executable, args: expandArgs(ctx.settings.emulators.xenia.argsTemplate, game.path) };
  },
};
