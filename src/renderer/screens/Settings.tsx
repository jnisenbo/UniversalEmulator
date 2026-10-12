import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMULATOR_LABEL, type EmulatorId } from '@shared/platforms';
import { api } from '../api';
import { useInputHandler } from '../input/useInput';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { useStore } from '../state/store';
import { ActionMenu, type MenuItem } from '../components/ActionMenu';
import { ButtonHints } from '../components/ButtonHints';
import { TopBar } from '../components/TopBar';
import { adjustRow, isFocusable, RowView, type Row } from '../components/settings/rows';
import { PairWizard } from '../components/controller/PairWizard';
import { Calibration } from '../components/controller/Calibration';
import { ButtonLayout } from '../components/controller/ButtonLayout';
import { emulatorRows, isInstalling, shortPath } from './settings/emulators';

type SectionId = 'emulators' | 'library' | 'controller' | 'graphics' | 'artwork' | 'interface' | 'system';
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'emulators', label: 'Emulators' },
  { id: 'library', label: 'Library' },
  { id: 'controller', label: 'Controller' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'artwork', label: 'Artwork' },
  { id: 'interface', label: 'Interface' },
  { id: 'system', label: 'System' },
];

const LIGHT_COLORS = [
  { label: 'Blue', rgb: { r: 64, g: 120, b: 255 } },
  { label: 'Violet', rgb: { r: 150, g: 80, b: 255 } },
  { label: 'Teal', rgb: { r: 0, g: 200, b: 180 } },
  { label: 'Green', rgb: { r: 40, g: 220, b: 90 } },
  { label: 'Amber', rgb: { r: 255, g: 160, b: 20 } },
  { label: 'Red', rgb: { r: 255, g: 50, b: 60 } },
  { label: 'White', rgb: { r: 230, g: 230, b: 240 } },
  { label: 'Off', rgb: { r: 0, g: 0, b: 0 } },
];

const ASPECTS = ['auto', '16:9', '4:3', 'stretch'] as const;
const ASPECT_LABEL = { auto: 'Auto', '16:9': '16:9', '4:3': '4:3', stretch: 'Stretch' } as const;
const RES_LABEL = ['', 'Native', '2×', '3×', '4×'];

const pct = (v: number): string => `${Math.round(v * 100)}%`;

type ModalState = { kind: 'pair' } | { kind: 'calibrate' } | { kind: 'layout' } | { kind: 'emulator'; id: EmulatorId } | null;

export function Settings() {
  const settings = useStore((s) => s.settings);
  const emulators = useStore((s) => s.emulators);
  const installs = useStore((s) => s.installs);
  const installProgress = useStore((s) => s.installProgress);
  const controller = useStore((s) => s.controller);
  const games = useStore((s) => s.games);
  const scan = useStore((s) => s.scan);
  const { updateSettings, refreshEmulators, refreshInstalls, install, rescan, setScreen, toast } = useStore.getState();

  const [col, setCol] = useState<'nav' | 'panel'>(() => (useStore.getState().settingsSection ? 'panel' : 'nav'));
  const [section, setSection] = useState(() => Math.max(0, SECTIONS.findIndex((s) => s.id === useStore.getState().settingsSection)));
  useEffect(() => useStore.setState({ settingsSection: null }), []);
  const [rowIndex, setRowIndex] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    void refreshEmulators();
    void refreshInstalls(false);
  }, [refreshEmulators, refreshInstalls]);

  const pickEmulator = useCallback(
    async (id: EmulatorId) => {
      const path = await api.invoke('dialog:pick', { kind: 'app', title: `Select ${EMULATOR_LABEL[id]}` });
      if (!path) return;
      await updateSettings({ emulators: { [id]: { appPath: path } } });
      await refreshEmulators();
    },
    [updateSettings, refreshEmulators],
  );

  const autodetect = useCallback(async () => {
    const found = await api.invoke('emulators:autodetect');
    const ids = Object.keys(found) as EmulatorId[];
    if (!ids.length) {
      toast({ level: 'info', title: 'No emulators found in the usual places', detail: 'Install them from here, or choose each one manually.' });
      return;
    }
    await updateSettings({ emulators: Object.fromEntries(ids.map((id) => [id, { appPath: found[id] }])) });
    await refreshEmulators();
    toast({ level: 'info', title: `Found ${ids.map((id) => EMULATOR_LABEL[id]).join(', ')}` });
  }, [updateSettings, refreshEmulators, toast]);

  const installAll = useCallback(async () => {
    const s = useStore.getState();
    const missing = s.installs.filter((i) => i.installable && !s.settings?.emulators[i.id].appPath).map((i) => i.id);
    for (const id of missing) {
      const ok = await install(id);
      if (ok) toast({ level: 'info', title: `${EMULATOR_LABEL[id]} installed` });
    }
  }, [install, toast]);

  const emulatorMenu = useCallback(
    (id: EmulatorId): MenuItem[] => {
      const info = installs.find((i) => i.id === id);
      const path = settings?.emulators[id].appPath ?? null;
      const busy = isInstalling(installProgress[id]);
      const items: MenuItem[] = [];
      if (info?.installable) {
        const label = !path ? 'Install latest version' : info.managedVersion ? (info.latestVersion && info.latestVersion !== info.managedVersion ? `Update to ${info.latestVersion}` : 'Reinstall latest version') : 'Install Arcadia’s own copy';
        items.push({
          label,
          detail: 'Official Mac build, checksum-verified, into ~/Applications',
          disabled: busy,
          run: () => void install(id).then((ok) => ok && toast({ level: 'info', title: `${EMULATOR_LABEL[id]} is ready` })),
        });
      } else {
        items.push({ label: `Get ${EMULATOR_LABEL[id]} from its website`, detail: 'Experimental: no automatic install yet', run: () => void api.invoke('emulators:openHomepage', { id }) });
      }
      if (path) {
        items.push({ label: `Open ${EMULATOR_LABEL[id]}`, ...(info?.firstRun ? { detail: info.firstRun } : {}), run: () => void api.invoke('emulators:openApp', { id }).catch((e: Error) => toast({ level: 'error', title: e.message })) });
      }
      items.push({ label: path ? 'Use a different copy…' : 'Choose an installed copy…', run: () => void pickEmulator(id) });
      if (info?.installable) items.push({ label: 'Project website', run: () => void api.invoke('emulators:openHomepage', { id }) });
      return items;
    },
    [installs, settings, installProgress, install, pickEmulator, toast],
  );

  const rows: Row[] = useMemo(() => {
    if (!settings) return [];
    const c = settings.controller;
    const g = settings.graphics;
    switch (SECTIONS[section]!.id) {
      case 'emulators':
        return emulatorRows({
          settings,
          statuses: emulators,
          installs,
          progress: installProgress,
          openMenu: (id) => setModal({ kind: 'emulator', id }),
          installAll: () => void installAll(),
          checkUpdates: () => void refreshInstalls(true).then(() => toast({ level: 'info', title: 'Checked for updates' })),
          autodetect: () => void autodetect(),
        });
      case 'library':
        return [
          ...settings.libraryFolders.map<Row>((f) => ({
            kind: 'action',
            id: `folder-${f}`,
            label: shortPath(f),
            value: armedRemove === f ? 'Press again to remove' : 'Remove',
            danger: armedRemove === f,
            onConfirm: () => {
              if (armedRemove !== f) return setArmedRemove(f);
              setArmedRemove(null);
              void updateSettings({ libraryFolders: settings.libraryFolders.filter((x) => x !== f) }).then(() => rescan());
            },
          })),
          {
            kind: 'action',
            id: 'add-folder',
            label: 'Add a game folder…',
            detail: 'Subfolders are included. Wii/GameCube (.iso .rvz .wbfs .gcz), Switch (.nsp .xci), Xbox (.iso), Xbox 360 (.iso .xex, XBLA packages)',
            onConfirm: async () => {
              const p = await api.invoke('dialog:pick', { kind: 'folder', title: 'Add a game folder' });
              if (p && !settings.libraryFolders.includes(p)) {
                await updateSettings({ libraryFolders: [...settings.libraryFolders, p] });
                void rescan();
              }
            },
          },
          { kind: 'action', id: 'rescan', label: 'Rescan library', value: scan ? `${scan.scanned}/${scan.total}` : `${games.length} games`, onConfirm: () => void rescan() },
          {
            kind: 'action',
            id: 'keys',
            label: 'Switch keys (prod.keys)',
            detail: `${settings.switchKeysPath ? shortPath(settings.switchKeysPath) : "Using Ryubing's keys"}. Read in place to identify Switch dumps; never copied or uploaded.`,
            value: 'Choose…',
            onConfirm: async () => {
              const p = await api.invoke('dialog:pick', { kind: 'file', title: 'Select your prod.keys' });
              if (p) {
                await updateSettings({ switchKeysPath: p });
                void rescan();
              }
            },
          },
        ];
      case 'controller': {
        const pad = controller.controllers[0];
        const lightIndex = Math.max(0, LIGHT_COLORS.findIndex((l) => l.rgb.r === c.lightBar.r && l.rgb.g === c.lightBar.g && l.rgb.b === c.lightBar.b));
        const remapped = Object.keys(c.layout).length;
        return [
          {
            kind: 'info',
            id: 'pad-status',
            label: pad ? `${pad.name}${pad.battery !== null ? ` · ${pct(pad.battery)}${pad.charging ? ' charging' : ''}` : ''}` : 'No controller connected',
            ...(controller.helper !== 'running' && controller.helperMessage ? { detail: controller.helperMessage } : {}),
            level: pad ? 'ok' : 'warn',
          },
          { kind: 'action', id: 'pair', label: 'Pair a wireless controller', detail: 'Connect over Bluetooth, step by step', onConfirm: () => setModal({ kind: 'pair' }) },
          {
            kind: 'action',
            id: 'layout',
            label: 'Button layout',
            detail: 'Move any button anywhere. Applies to every emulator and to Arcadia.',
            value: remapped ? `${remapped} changed` : 'Default',
            onConfirm: () => setModal({ kind: 'layout' }),
          },
          { kind: 'action', id: 'calibrate', label: 'Calibrate and test', detail: 'Stick dead zones, trigger threshold, buttons and rumble', onConfirm: () => setModal({ kind: 'calibrate' }) },
          {
            kind: 'choice',
            id: 'light',
            label: 'Light bar',
            options: LIGHT_COLORS.map((l) => ({ label: l.label, swatch: `rgb(${l.rgb.r} ${l.rgb.g} ${l.rgb.b})` })),
            index: lightIndex,
            onChange: (i) => void updateSettings({ controller: { lightBar: LIGHT_COLORS[i]!.rgb } }),
          },
          { kind: 'toggle', id: 'rumble', label: 'Vibration in games', value: c.rumble, onChange: (v) => void updateSettings({ controller: { rumble: v } }) },
          { kind: 'toggle', id: 'motion', label: 'Motion controls', detail: 'Uses the controller gyro for Wii Remote motion and Switch motion', value: c.motion, onChange: (v) => void updateSettings({ controller: { motion: v } }) },
          {
            kind: 'action',
            id: 'home-button',
            label: 'Home button',
            detail: 'Opens Arcadia’s menu during a game. If it opens Apple’s Games app instead, turn that off in System Settings → Game Controllers (or hold Create + Options).',
            value: 'Open…',
            onConfirm: () => void api.invoke('system:openSettingsPane', 'gameControllers'),
          },
          {
            kind: 'text',
            id: 'dolphin-device',
            label: 'Dolphin device name',
            detail: 'Only change this if Dolphin doesn’t see your controller',
            value: c.dolphinDevice,
            onCommit: (v) => void updateSettings({ controller: { dolphinDevice: v } }),
          },
        ];
      }
      case 'graphics':
        return [
          { kind: 'info', id: 'gfx-note', label: 'Applies to Dolphin, Ryubing and xemu the next time a game starts. Xenia uses its own settings.' },
          { kind: 'slider', id: 'res', label: 'Internal resolution', detail: 'Multiples of the console’s own resolution. 2× (about 1080p for Wii/GameCube) suits most Apple Silicon Macs; 3–4× on Pro and Max chips.', value: g.resolutionScale, min: 1, max: 4, step: 1, format: (v) => RES_LABEL[v] ?? `${v}×`, onChange: (v) => void updateSettings({ graphics: { resolutionScale: v } }) },
          { kind: 'toggle', id: 'vsync', label: 'VSync', detail: 'Prevents tearing. Turn off only if a game stutters.', value: g.vsync, onChange: (v) => void updateSettings({ graphics: { vsync: v } }) },
          {
            kind: 'choice',
            id: 'aspect',
            label: 'Aspect ratio',
            options: ASPECTS.map((a) => ({ label: ASPECT_LABEL[a] })),
            index: ASPECTS.indexOf(g.aspect),
            onChange: (i) => void updateSettings({ graphics: { aspect: ASPECTS[i]! } }),
          },
          { kind: 'toggle', id: 'fps', label: 'Show frame rate', detail: 'Dolphin only', value: g.showFps, onChange: (v) => void updateSettings({ graphics: { showFps: v } }) },
        ];
      case 'artwork':
        return [
          {
            kind: 'text',
            id: 'sgdb-key',
            label: 'SteamGridDB API key',
            detail: settings.metadata.steamGridDbKey ? 'Saved. Covers, backgrounds and logos download automatically.' : 'Free at steamgriddb.com → Preferences → API. Paste it here with the keyboard.',
            value: settings.metadata.steamGridDbKey ? '••••••••' + settings.metadata.steamGridDbKey.slice(-4) : 'Not set',
            onCommit: (v) => void updateSettings({ metadata: { steamGridDbKey: v && !v.startsWith('••') ? v : settings.metadata.steamGridDbKey } }),
          },
          { kind: 'toggle', id: 'sgdb-auto', label: 'Download artwork automatically', value: settings.metadata.autoFetch, onChange: (v) => void updateSettings({ metadata: { autoFetch: v } }) },
          { kind: 'action', id: 'sgdb-now', label: 'Get missing artwork now', detail: 'To fix a wrong match, press Options on a game in the library', onConfirm: () => void rescan() },
        ];
      case 'interface':
        return [
          { kind: 'toggle', id: 'sounds', label: 'Interface sounds', value: settings.ui.sounds, onChange: (v) => void updateSettings({ ui: { sounds: v } }) },
          { kind: 'slider', id: 'volume', label: 'Sound volume', value: settings.ui.volume, min: 0, max: 1, step: 0.1, format: pct, onChange: (v) => void updateSettings({ ui: { volume: v } }) },
          { kind: 'toggle', id: 'drift', label: 'Background motion', detail: 'Slow drift on the background art. Off by default.', value: settings.ui.backgroundDrift, onChange: (v) => void updateSettings({ ui: { backgroundDrift: v } }) },
          { kind: 'text', id: 'quit-shortcut', label: 'Keyboard shortcut to quit a game', detail: 'Works while a game is in front', value: settings.quitShortcut, onCommit: (v) => void updateSettings({ quitShortcut: v || 'Command+Shift+Escape' }) },
        ];
      case 'system':
        return [{ kind: 'action', id: 'quit', label: 'Quit Arcadia', onConfirm: () => void api.invoke('app:quit') }];
    }
  }, [settings, section, emulators, installs, installProgress, controller, games.length, scan, armedRemove, autodetect, installAll, updateSettings, refreshInstalls, rescan, toast]);

  // Keep the row index on a focusable row when the list changes.
  const focusable = rows.map((r, i) => (isFocusable(r) ? i : -1)).filter((i) => i >= 0);
  const current = focusable.includes(rowIndex) ? rowIndex : (focusable[0] ?? 0);

  useEffect(() => {
    document.querySelector('.settings-panel .srow[data-focused="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, col]);

  const handle = useCallback(
    (e: InputEvent): boolean => {
      if (editing) return true;
      if (modal) return false;
      // Confirm commits on release (press only highlights); everything else acts on press.
      if (e.kind === 'release' && e.action !== 'confirm') return false;
      if (e.action === 'confirm' && e.kind === 'repeat') return true;
      const row = rows[current];
      if (col === 'nav') {
        switch (e.action) {
          case 'up':
          case 'down': {
            const next = Math.max(0, Math.min(SECTIONS.length - 1, section + (e.action === 'down' ? 1 : -1)));
            if (next !== section) {
              play('move');
              setSection(next);
              setRowIndex(0);
              setArmedRemove(null);
            }
            return true;
          }
          case 'right':
          case 'confirm':
            if (e.action === 'confirm' && e.kind !== 'release') return true;
            play('move');
            setCol('panel');
            return true;
          case 'back':
            play('back');
            setScreen('home');
            return true;
          default:
            return false;
        }
      }
      switch (e.action) {
        case 'up':
        case 'down': {
          const pos = focusable.indexOf(current) + (e.action === 'down' ? 1 : -1);
          const next = focusable[Math.max(0, Math.min(focusable.length - 1, pos))];
          if (next !== undefined && next !== current) {
            play('move');
            setRowIndex(next);
            setArmedRemove(null);
          }
          return true;
        }
        case 'left':
        case 'right':
          if (row && adjustRow(row, e.action === 'right' ? 1 : -1)) play('move');
          else if (e.action === 'left') {
            play('move');
            setCol('nav');
          }
          return true;
        case 'confirm':
          if (e.kind !== 'release' || !row) return true;
          play('confirm');
          if (row.kind === 'action') row.onConfirm();
          else if (row.kind === 'toggle') row.onChange(!row.value);
          else if (row.kind === 'text') setEditing(row.id);
          return true;
        case 'back':
          play('back');
          setCol('nav');
          setArmedRemove(null);
          return true;
        default:
          return false;
      }
    },
    [modal, editing, rows, current, col, section, focusable, setScreen],
  );

  useInputHandler(handle);

  if (!settings) return null;
  return (
    <div className="screen settings">
      <div className="settings-bg" />
      <TopBar focusedTab={null} />
      <div className="settings-body">
        <nav className="settings-nav material-heavy">
          {SECTIONS.map((s, i) => (
            <div key={s.id} className="nav-item" data-selected={i === section} data-focused={col === 'nav' && i === section} onClick={() => { setSection(i); setRowIndex(0); setCol('panel'); }}>
              {s.label}
            </div>
          ))}
        </nav>
        <section className="settings-panel" key={section}>
          <h2 className="panel-title">{SECTIONS[section]!.label}</h2>
          {rows.map((r, i) => (
            <RowView
              key={r.id}
              row={r}
              focused={col === 'panel' && i === current}
              editing={editing === r.id}
              onEditDone={() => setEditing(null)}
              onPointerConfirm={() => {
                if (!isFocusable(r)) return;
                setCol('panel');
                setRowIndex(i);
                if (r.kind === 'action') r.onConfirm();
                else if (r.kind === 'toggle') r.onChange(!r.value);
                else if (r.kind === 'text') setEditing(r.id);
              }}
            />
          ))}
        </section>
      </div>
      <ButtonHints
        hints={[
          { button: 'south', label: col === 'nav' ? 'Open' : 'Select' },
          { button: 'east', label: 'Back' },
          { button: 'L', label: 'Library' },
        ]}
      />
      {modal?.kind === 'pair' && <PairWizard onClose={() => setModal(null)} />}
      {modal?.kind === 'calibrate' && <Calibration onClose={() => setModal(null)} />}
      {modal?.kind === 'layout' && <ButtonLayout onClose={() => setModal(null)} />}
      {modal?.kind === 'emulator' && <ActionMenu title={EMULATOR_LABEL[modal.id]} items={emulatorMenu(modal.id)} onClose={() => setModal(null)} />}
    </div>
  );
}
