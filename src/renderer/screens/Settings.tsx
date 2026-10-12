import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMULATOR_LABEL, type EmulatorId } from '@shared/platforms';
import type { Settings as SettingsT } from '@shared/settings';
import type { EmulatorStatus } from '@shared/types';
import { api } from '../api';
import { useInputHandler } from '../input/useInput';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { useStore } from '../state/store';
import { ButtonHints } from '../components/ButtonHints';
import { TopBar } from '../components/TopBar';
import { adjustRow, isFocusable, RowView, type Row } from '../components/settings/rows';
import { PairWizard } from '../components/controller/PairWizard';
import { Calibration } from '../components/controller/Calibration';

type SectionId = 'emulators' | 'library' | 'controller' | 'interface' | 'system';
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'emulators', label: 'Emulators' },
  { id: 'library', label: 'Library' },
  { id: 'controller', label: 'Controller' },
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

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const shortPath = (p: string | null): string => (p ? p.replace(/^\/Users\/[^/]+/, '~') : 'Not set');

function emulatorRows(s: SettingsT, statuses: EmulatorStatus[], pick: (id: EmulatorId) => void, autodetect: () => void, update: ReturnType<typeof useStore.getState>['updateSettings']): Row[] {
  const rows: Row[] = [{ kind: 'action', id: 'autodetect', label: 'Find installed emulators', detail: 'Looks in /Applications, ~/Applications and ~/Downloads', onConfirm: autodetect }];
  for (const id of ['dolphin', 'ryubing', 'xenia'] as const) {
    const st = statuses.find((x) => x.id === id);
    const path = s.emulators[id].appPath;
    rows.push({
      kind: 'action',
      id: `emu-${id}`,
      label: EMULATOR_LABEL[id],
      detail: [shortPath(path), st?.version ? `v${st.version}` : null, st?.arch.length ? st.arch.join('/') : null].filter(Boolean).join(' · '),
      value: 'Choose…',
      onConfirm: () => pick(id),
    });
    for (const [i, issue] of (st?.issues ?? []).entries()) {
      rows.push({ kind: 'info', id: `emu-${id}-issue-${i}`, label: issue.message, level: issue.level });
    }
    if (id === 'xenia') {
      rows.push({
        kind: 'text',
        id: 'xenia-args',
        label: 'Xenia launch arguments',
        detail: '{game} is replaced with the game path',
        value: s.emulators.xenia.argsTemplate,
        onCommit: (v) => void update({ emulators: { xenia: { argsTemplate: v || '{game}' } } }),
      });
    }
  }
  return rows;
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const emulators = useStore((s) => s.emulators);
  const controller = useStore((s) => s.controller);
  const games = useStore((s) => s.games);
  const scan = useStore((s) => s.scan);
  const { updateSettings, refreshEmulators, rescan, setScreen, toast } = useStore.getState();

  const [col, setCol] = useState<'nav' | 'panel'>('nav');
  const [section, setSection] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const [modal, setModal] = useState<'pair' | 'calibrate' | null>(null);

  useEffect(() => {
    void refreshEmulators();
  }, [refreshEmulators]);

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
      toast({ level: 'info', title: 'No emulators found in the usual places', detail: 'Choose each one manually.' });
      return;
    }
    await updateSettings({ emulators: Object.fromEntries(ids.map((id) => [id, { appPath: found[id] }])) });
    await refreshEmulators();
    toast({ level: 'info', title: `Found ${ids.map((id) => EMULATOR_LABEL[id]).join(', ')}` });
  }, [updateSettings, refreshEmulators, toast]);

  const rows: Row[] = useMemo(() => {
    if (!settings) return [];
    const c = settings.controller;
    switch (SECTIONS[section]!.id) {
      case 'emulators':
        return emulatorRows(settings, emulators, (id) => void pickEmulator(id), () => void autodetect(), updateSettings);
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
            detail: 'Subfolders are included. Wii/GameCube (.iso .rvz .wbfs .gcz), Switch (.nsp .xci), Xbox 360 (.iso .xex, XBLA packages)',
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
            detail: `${shortPath(settings.switchKeysPath) === 'Not set' ? "Using Ryubing's keys" : shortPath(settings.switchKeysPath)}. Read in place to identify Switch dumps; never copied or uploaded.`,
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
        return [
          {
            kind: 'info',
            id: 'pad-status',
            label: pad ? `${pad.name}${pad.battery !== null ? ` · ${pct(pad.battery)}${pad.charging ? ' charging' : ''}` : ''}` : 'No controller connected',
            ...(controller.helper !== 'running' && controller.helperMessage ? { detail: controller.helperMessage } : {}),
            level: pad ? 'ok' : 'warn',
          },
          { kind: 'action', id: 'pair', label: 'Pair a wireless controller', detail: 'Connect over Bluetooth, step by step', onConfirm: () => setModal('pair') },
          { kind: 'action', id: 'calibrate', label: 'Calibrate and test', detail: 'Stick dead zones, trigger threshold, buttons and rumble', onConfirm: () => setModal('calibrate') },
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
            detail: 'If the Home button opens Apple’s Games app, turn that off in System Settings → Game Controllers. Create + Options also works.',
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
  }, [settings, section, emulators, controller, games.length, scan, armedRemove, pickEmulator, autodetect, updateSettings, rescan]);

  // Keep the row index on a focusable row when the list changes.
  const focusable = rows.map((r, i) => (isFocusable(r) ? i : -1)).filter((i) => i >= 0);
  const current = focusable.includes(rowIndex) ? rowIndex : (focusable[0] ?? 0);

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
      {modal === 'pair' && <PairWizard onClose={() => setModal(null)} />}
      {modal === 'calibrate' && <Calibration onClose={() => setModal(null)} />}
    </div>
  );
}
