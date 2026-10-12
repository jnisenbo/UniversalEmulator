import { useCallback, useEffect, useState } from 'react';
import { EMULATOR_LABEL, PLATFORM_INFO } from '@shared/platforms';
import { api } from '../api';
import { placeholderArt } from '../art/placeholder';
import { gameName } from '../art/name';
import { injectAction } from '../input/input';
import { useInputHandler } from '../input/useInput';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { useStore } from '../state/store';
import { ButtonHints } from '../components/ButtonHints';

function formatPlayed(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'Just started' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * The in-game menu, shown over the running emulator when Home is pressed.
 * Input arrives through the Gamepad API when this window has focus, or is
 * forwarded by the native helper when macOS keeps focus on the emulator.
 */
export function OverlayApp() {
  const session = useStore((s) => s.session);
  const games = useStore((s) => s.games);
  const artMap = useStore((s) => s.art);
  const pad = useStore((s) => s.controller.controllers[0]);
  const [focus, setFocus] = useState(0);
  const [armedQuit, setArmedQuit] = useState(false);
  const [now, setNow] = useState(Date.now());
  // The window exists hidden between uses; it must not act on input then.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('overlay');
    const offInput = api.on('overlay:input', ({ action }) => injectAction(action));
    const offOpen = api.on('overlay:opened', () => {
      setOpen(true);
      setFocus(0);
      setArmedQuit(false);
      setNow(Date.now());
      play('tab');
    });
    return () => {
      offInput();
      offOpen();
    };
  }, []);

  const resume = useCallback(() => {
    play('back');
    setOpen(false);
    void api.invoke('overlay:resume');
  }, []);

  const quit = useCallback(() => {
    if (!armedQuit) {
      setArmedQuit(true);
      play('edge');
      return;
    }
    play('confirm');
    setOpen(false);
    void api.invoke('overlay:quitGame');
  }, [armedQuit]);

  const actions = [
    { label: 'Resume', run: resume },
    { label: armedQuit ? 'Press again to quit (unsaved progress is lost)' : 'Quit game', run: quit, danger: armedQuit },
  ];

  useInputHandler((e: InputEvent) => {
    if (!open) return true;
    if (e.action === 'back' && e.kind === 'press') resume();
    else if ((e.action === 'up' || e.action === 'down' || e.action === 'left' || e.action === 'right') && e.kind === 'press') {
      setFocus((f) => (f + 1) % actions.length);
      setArmedQuit(false);
      play('move');
    } else if (e.action === 'confirm' && e.kind === 'release') actions[focus]?.run();
    return true;
  });

  const game = 'gameId' in session ? games.find((g) => g.id === session.gameId) : undefined;
  const cover = game ? (artMap[game.id]?.grid ? `url("${artMap[game.id]!.grid}") center / cover` : placeholderArt(game).tile) : undefined;
  const played = session.kind === 'running' ? formatPlayed(now - session.startedAt) : '';

  return (
    <div className="ov-root">
      <div className="ov-scrim" />
      <div className="ov-panel material-heavy">
        {game && (
          <div className="ov-game">
            <div className="ov-cover" style={{ background: cover }} />
            <div>
              <div className="ov-title">{gameName(game, artMap[game.id])}</div>
              <div className="ov-meta">
                {[PLATFORM_INFO[game.platform].label, EMULATOR_LABEL[game.emulator], played].filter(Boolean).join('  ·  ')}
              </div>
            </div>
          </div>
        )}
        <div className="ov-actions">
          {actions.map((a, i) => (
            <button key={i} className="pill ov-action" data-focused={i === focus} data-danger={!!a.danger} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="ov-footer">
          {pad && pad.battery !== null && <span className="ov-battery">Controller {Math.round(pad.battery * 100)}%</span>}
          <ButtonHints hints={[{ button: 'south', label: 'Select' }, { button: 'east', label: 'Resume' }]} />
        </div>
      </div>
    </div>
  );
}
