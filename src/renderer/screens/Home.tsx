import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMULATOR_LABEL, PLATFORM_INFO } from '@shared/platforms';
import { api } from '../api';
import { placeholderArt } from '../art/placeholder';
import { project } from '../engine/spring';
import { useInputHandler } from '../input/useInput';
import type { InputEvent } from '../input/actions';
import { play } from '../sound/sfx';
import { useStore } from '../state/store';
import { ButtonHints } from '../components/ButtonHints';
import { GameRow, type GameRowHandle } from '../components/GameRow';
import { HeroBackground } from '../components/HeroBackground';
import { LaunchOverlay, type LaunchOrigin } from '../components/LaunchOverlay';
import { TopBar } from '../components/TopBar';

type Zone = 'tabs' | 'row' | 'play';

/** Fast stick scrubs (repeat under this) carry momentum when released. */
const MOMENTUM_INTERVAL_MS = 110;
const MAX_MOMENTUM_TILES = 4;

function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function Home() {
  const games = useStore((s) => s.games);
  const focusedGameId = useStore((s) => s.focusedGameId);
  const setFocusedGame = useStore((s) => s.setFocusedGame);
  const session = useStore((s) => s.session);
  const settings = useStore((s) => s.settings);
  const scan = useStore((s) => s.scan);
  const toast = useStore((s) => s.toast);
  const setScreen = useStore((s) => s.setScreen);

  const [zone, setZone] = useState<Zone>('row');
  const [pressed, setPressed] = useState(false);
  const [origin, setOrigin] = useState<LaunchOrigin | null>(null);
  const row = useRef<GameRowHandle>(null);

  const index = Math.max(0, games.findIndex((g) => g.id === focusedGameId));
  const game = games[index] ?? null;
  const art = useMemo(() => (game ? placeholderArt(game) : null), [game]);

  const focusIndex = useCallback(
    (i: number, opts?: { velocity?: number; momentum?: boolean }) => {
      const clamped = Math.max(0, Math.min(games.length - 1, i));
      const g = games[clamped];
      if (!g) return;
      row.current?.focus(clamped, opts);
      setFocusedGame(g.id);
    },
    [games, setFocusedGame],
  );

  const launch = useCallback(
    async (i: number) => {
      const g = games[i];
      if (!g || session.kind !== 'idle') return;
      const rect = row.current?.tileRect(i);
      play('launch');
      if (rect) setOrigin({ rect, background: placeholderArt(g).tile });
      const result = await api.invoke('game:launch', { gameId: g.id });
      if (!result.ok) {
        play('error');
        setOrigin(null);
        toast({ level: 'error', title: `Couldn't start ${g.displayTitle}`, ...(result.error ? { detail: result.error } : {}) });
      }
      for (const w of result.warnings) toast({ level: 'warn', title: w });
    },
    [games, session.kind, toast],
  );

  const handle = useCallback(
    (e: InputEvent): boolean => {
      if (e.action === 'confirm') {
        if (e.kind === 'press') setPressed(true);
        if (e.kind !== 'release') return true;
        setPressed(false);
        if (zone === 'tabs') {
          play('tab');
          setScreen('settings');
        } else if (games.length === 0) {
          play('confirm');
          setScreen('settings');
        } else {
          play('confirm');
          void launch(index);
        }
        return true;
      }
      if (e.kind === 'release') {
        // Momentum: a fast stick scrub keeps travelling after you let go.
        if (zone === 'row' && e.source === 'stick' && (e.action === 'left' || e.action === 'right') && e.interval !== undefined && e.interval < MOMENTUM_INTERVAL_MS && row.current) {
          const dir = e.action === 'right' ? 1 : -1;
          const v = (row.current.stridePx() / Math.max(e.interval, 30)) * 1000;
          const extra = Math.min(MAX_MOMENTUM_TILES, Math.round(project(v) / row.current.stridePx()));
          if (extra > 0) focusIndex(index + dir * extra, { velocity: dir * v, momentum: true });
        }
        return true;
      }
      switch (e.action) {
        case 'left':
        case 'right': {
          if (zone !== 'row') return true;
          const dir = e.action === 'right' ? 1 : -1;
          const next = index + dir;
          if (next < 0 || next >= games.length) {
            if (e.kind === 'press') {
              row.current?.bumpEdge(dir);
              play('edge');
            }
            return true;
          }
          play('move');
          focusIndex(next);
          return true;
        }
        case 'up':
          if (zone === 'play') setZone('row');
          else if (zone === 'row') setZone('tabs');
          else return true;
          play('move');
          return true;
        case 'down':
          if (zone === 'tabs') setZone('row');
          else if (zone === 'row' && game) setZone('play');
          else return true;
          play('move');
          return true;
        case 'back':
          if (zone !== 'row') {
            setZone('row');
            play('back');
          }
          return true;
        default:
          return false; // tabs (L/R) handled by App
      }
    },
    [zone, games.length, index, game, focusIndex, launch, setScreen],
  );

  useInputHandler(handle);

  // Returning from a game: focus is back on the row, on the same tile.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (session.kind !== 'idle') wasPlaying.current = true;
    else if (wasPlaying.current) {
      wasPlaying.current = false;
      setZone('row');
    }
  }, [session.kind]);

  const info = game ? PLATFORM_INFO[game.platform] : null;

  return (
    <div className="screen home">
      <HeroBackground artKey={game?.id ?? 'empty'} background={art?.hero ?? 'linear-gradient(120deg,#0b0d14,#05060a)'} drift={!!settings?.ui.backgroundDrift} />
      <TopBar focusedTab={zone === 'tabs' ? 'settings' : null} />

      {games.length > 0 ? (
        <GameRow ref={row} games={games} focusedIndex={index} active={zone === 'row'} onHover={() => setZone('row')} onActivate={(i) => (i === index ? void launch(i) : focusIndex(i))} />
      ) : (
        <div className="row-empty" />
      )}

      <section className="hero-info" key={game?.id ?? 'empty'}>
        {game && info ? (
          <>
            <div className="badges">
              <span className="badge" style={{ color: art?.accent }}>{info.label}</span>
              {info.experimental && <span className="badge badge-warn">Experimental</span>}
              {!game.identified && <span className="badge badge-muted">Unidentified</span>}
            </div>
            <h1 className="hero-title">{game.displayTitle}</h1>
            <div className="hero-meta">
              {[game.gameId, game.format.toUpperCase(), formatSize(game.sizeBytes), EMULATOR_LABEL[game.emulator], game.discNumber > 0 ? `Disc ${game.discNumber + 1}` : null].filter(Boolean).join('  ·  ')}
            </div>
            <button className="play" data-focused={zone === 'play'} data-pressed={pressed && zone === 'play'} onClick={() => void launch(index)}>
              Play
            </button>
          </>
        ) : (
          <>
            <h1 className="hero-title">{scan ? 'Looking for games…' : 'Your library is empty'}</h1>
            <p className="hero-meta">
              {scan ? `${scan.scanned} of ${scan.total} files checked` : 'Add the folders where you keep your game dumps, and choose where your emulators are installed.'}
            </p>
            {!scan && (
              <button className="play" data-focused={zone !== 'tabs'} onClick={() => setScreen('settings')}>
                Open Settings
              </button>
            )}
          </>
        )}
      </section>

      {scan && games.length > 0 && <div className="scan-chip">Updating library · {scan.scanned}/{scan.total}</div>}

      <ButtonHints
        hints={[
          { button: 'south', label: zone === 'tabs' ? 'Open' : games.length ? 'Play' : 'Settings' },
          ...(zone !== 'row' ? [{ button: 'east' as const, label: 'Back' }] : []),
          { button: 'R', label: 'Settings' },
        ]}
      />

      <LaunchOverlay origin={origin} session={session} onClosed={() => setOrigin(null)} />
    </div>
  );
}
