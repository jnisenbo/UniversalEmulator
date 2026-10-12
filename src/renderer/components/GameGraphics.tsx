import { useCallback, useMemo, useState } from 'react';
import { gameKey } from '@shared/library';
import type { Graphics } from '@shared/settings';
import type { Game } from '@shared/types';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { useStore } from '../state/store';
import { ButtonHints } from './ButtonHints';
import { Modal } from './controller/Modal';
import { adjustRow, RowView, type Row } from './settings/rows';

const ASPECT_LABEL: Record<Graphics['aspect'], string> = { auto: 'Auto', '16:9': '16:9', '4:3': '4:3', stretch: 'Stretch' };
const ASPECTS = Object.keys(ASPECT_LABEL) as Graphics['aspect'][];

/**
 * Per-game graphics: each setting is either "Default" (follows Settings →
 * Graphics) or a value just for this game.
 */
export function GameGraphics({ game, title, onClose }: { game: Game; title: string; onClose(): void }) {
  const settings = useStore((s) => s.settings!);
  const updateSettings = useStore((s) => s.updateSettings);
  const [focus, setFocus] = useState(0);
  const key = gameKey(game);
  const override = settings.gameGraphics[key] ?? {};
  const g = settings.graphics;

  const save = useCallback(
    (next: Partial<Graphics>) => {
      const all = { ...useStore.getState().settings!.gameGraphics };
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Partial<Graphics>;
      if (Object.keys(clean).length) all[key] = clean;
      else delete all[key];
      void updateSettings({ gameGraphics: all });
    },
    [key, updateSettings],
  );

  const rows: Row[] = useMemo(
    () => [
      {
        kind: 'choice',
        id: 'res',
        label: 'Internal resolution',
        detail: `Default follows Settings → Graphics (${g.resolutionScale === 1 ? 'Native' : `${g.resolutionScale}×`})`,
        options: [{ label: 'Default' }, { label: 'Native' }, { label: '2×' }, { label: '3×' }, { label: '4×' }],
        index: override.resolutionScale ?? 0,
        onChange: (i) => save({ ...override, resolutionScale: i === 0 ? undefined : i }),
      },
      {
        kind: 'choice',
        id: 'vsync',
        label: 'VSync',
        detail: `Default: ${g.vsync ? 'On' : 'Off'}`,
        options: [{ label: 'Default' }, { label: 'On' }, { label: 'Off' }],
        index: override.vsync === undefined ? 0 : override.vsync ? 1 : 2,
        onChange: (i) => save({ ...override, vsync: i === 0 ? undefined : i === 1 }),
      },
      {
        kind: 'choice',
        id: 'aspect',
        label: 'Aspect ratio',
        detail: `Default: ${ASPECT_LABEL[g.aspect]}`,
        options: [{ label: 'Default' }, ...ASPECTS.map((a) => ({ label: ASPECT_LABEL[a] }))],
        index: override.aspect ? ASPECTS.indexOf(override.aspect) + 1 : 0,
        onChange: (i) => save({ ...override, aspect: i === 0 ? undefined : ASPECTS[i - 1] }),
      },
      { kind: 'action', id: 'reset', label: 'Use defaults for this game', onConfirm: () => save({}) },
      { kind: 'action', id: 'done', label: 'Done', onConfirm: onClose },
    ],
    [g, override, save, onClose],
  );

  const onInput = useCallback(
    (e: InputEvent) => {
      const row = rows[focus];
      if (e.action === 'back' && e.kind === 'press') {
        play('back');
        onClose();
      } else if ((e.action === 'up' || e.action === 'down') && e.kind !== 'release') {
        setFocus((f) => Math.max(0, Math.min(rows.length - 1, f + (e.action === 'down' ? 1 : -1))));
        play('move');
      } else if ((e.action === 'left' || e.action === 'right') && e.kind === 'press' && row) {
        if (adjustRow(row, e.action === 'right' ? 1 : -1)) play('move');
      } else if (e.action === 'confirm' && e.kind === 'release' && row?.kind === 'action') {
        play('confirm');
        row.onConfirm();
      }
    },
    [rows, focus, onClose],
  );

  return (
    <Modal title={`Graphics · ${title}`} onInput={onInput} footer={<ButtonHints hints={[{ button: 'south', label: 'Select' }, { button: 'east', label: 'Close' }]} />}>
      <p className="menu-intro">Applies the next time this game starts. Dolphin, Ryubing and xemu only.</p>
      <div className="layout-list">
        {rows.map((r, i) => (
          <RowView key={r.id} row={r} focused={i === focus} editing={false} onEditDone={() => undefined} onPointerConfirm={() => { setFocus(i); if (r.kind === 'action') r.onConfirm(); }} />
        ))}
      </div>
    </Modal>
  );
}
