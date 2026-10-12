import { EMULATOR_IDS, EMULATOR_LABEL, PLATFORM_INFO, PLATFORMS, type EmulatorId } from '@shared/platforms';
import type { Settings } from '@shared/settings';
import type { EmulatorStatus, InstallInfo, InstallProgress } from '@shared/types';
import type { Row } from '../../components/settings/rows';

const PHASE_LABEL: Record<InstallProgress['phase'], string> = {
  resolving: 'Checking…',
  downloading: 'Downloading',
  verifying: 'Verifying…',
  extracting: 'Unpacking…',
  installing: 'Installing…',
  done: 'Installed',
  error: 'Failed',
};

export const isInstalling = (p?: InstallProgress): boolean => !!p && p.phase !== 'done' && p.phase !== 'error';

const platformsFor = (id: EmulatorId): string =>
  PLATFORMS.filter((p) => PLATFORM_INFO[p].emulator === id)
    .map((p) => PLATFORM_INFO[p].label)
    .join(', ');

export const shortPath = (p: string | null): string => (p ? p.replace(/^\/Users\/[^/]+/, '~') : 'Not set');

export function emulatorRows(opts: {
  settings: Settings;
  statuses: EmulatorStatus[];
  installs: InstallInfo[];
  progress: Partial<Record<EmulatorId, InstallProgress>>;
  openMenu(id: EmulatorId): void;
  installAll(): void;
  checkUpdates(): void;
  autodetect(): void;
}): Row[] {
  const { settings, statuses, installs, progress } = opts;
  const missing = EMULATOR_IDS.filter((id) => !settings.emulators[id].appPath && installs.find((i) => i.id === id)?.installable);
  const rows: Row[] = [];
  if (missing.length) {
    rows.push({
      kind: 'action',
      id: 'install-all',
      label: `Install ${missing.map((id) => EMULATOR_LABEL[id]).join(', ')}`,
      detail: 'Downloads the latest official Mac builds into ~/Applications and sets everything up. Emulators only: you add your own games, keys and BIOS files.',
      value: 'Install all',
      onConfirm: opts.installAll,
    });
  }
  rows.push({ kind: 'action', id: 'autodetect', label: 'Find emulators already installed', detail: 'Looks in /Applications, ~/Applications and ~/Downloads', onConfirm: opts.autodetect });

  for (const id of EMULATOR_IDS) {
    const st = statuses.find((x) => x.id === id);
    const info = installs.find((x) => x.id === id);
    const p = progress[id];
    const path = settings.emulators[id].appPath;
    const update = info?.managedVersion && info.latestVersion && info.latestVersion !== info.managedVersion ? info.latestVersion : null;
    let value: string;
    let fraction: number | undefined;
    if (isInstalling(p)) {
      fraction = p!.phase === 'downloading' && p!.total ? (p!.received ?? 0) / p!.total : undefined;
      value = p!.phase === 'downloading' && fraction !== undefined ? `${Math.round(fraction * 100)}%` : PHASE_LABEL[p!.phase];
    } else if (!path) value = info?.installable ? 'Install' : 'Get it…';
    else if (update) value = `Update to ${update}`;
    else value = 'Options';

    rows.push({
      kind: 'action',
      id: `emu-${id}`,
      label: EMULATOR_LABEL[id],
      detail: [platformsFor(id), path ? shortPath(path) : null, st?.version ? `v${st.version}` : info?.managedVersion ? `v${info.managedVersion}` : null].filter(Boolean).join(' · '),
      value,
      ...(fraction !== undefined ? { progress: fraction } : {}),
      onConfirm: () => opts.openMenu(id),
    });
    if (p?.phase === 'error' && p.message) rows.push({ kind: 'info', id: `emu-${id}-err`, label: p.message, level: 'error' });
    else if (p?.phase === 'done' && info?.firstRun) rows.push({ kind: 'info', id: `emu-${id}-next`, label: `Next: ${info.firstRun}`, level: 'warn' });
    for (const [i, issue] of (path ? (st?.issues ?? []) : []).entries()) {
      rows.push({ kind: 'info', id: `emu-${id}-issue-${i}`, label: issue.message, level: issue.level });
    }
  }
  rows.push({ kind: 'action', id: 'check-updates', label: 'Check for emulator updates', onConfirm: opts.checkUpdates });
  return rows;
}
