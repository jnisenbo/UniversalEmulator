import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMULATOR_LABEL, PLATFORM_INFO, PLATFORMS } from '@shared/platforms';
import { presetFor } from '@shared/presets';
import { api } from '../api';
import { placeholderArt } from '../art/placeholder';
import { gameName } from '../art/name';
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
import { GameGraphics } from '../components/GameGraphics';
import { LayoutGlyph } from '../components/ButtonHints';
import { arrangeLibrary, formatLastPlayed, formatPlayTime, gameKey, type LibraryFilter } from '@shared/library';
import { ActionMenu, type MenuItem } from '../components/ActionMenu';
import { SetupChecklist, useSetupSteps } from '../components/SetupChecklist';
import type { ArtSearchResult } from '@shared/types';

type Zone = 'tabs' | 'row' | 'play';

/** Fast stick scrubs (repeat under this) carry momentum when released. */
const MOMENTUM_INTERVAL_MS = 110;
const MAX_MOMENTUM_TILES = 4;

function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function Home() {
  const allGames = useStore((s) => s.games);
  const history = useStore((s) => s.history);
  const focusedGameId = useStore((s) => s.focusedGameId);
  const setFocusedGame = useStore((s) => s.setFocusedGame);
  const session = useStore((s) => s.session);
  const settings = useStore((s) => s.settings);
  const scan = useStore((s) => s.scan);
  const toast = useStore((s) => s.toast);
  const setScreen = useStore((s) => s.setScreen);
  const artMap = useStore((s) => s.art);
  const updateSettings = useStore((s) => s.updateSettings);
  const sort = settings?.ui.sort ?? 'recent';
  const filter = settings?.ui.filter ?? 'all';
  // What the row shows: recently played first, narrowed to one console if filtered.
  const games = useMemo(() => arrangeLibrary(allGames, history, sort, filter), [allGames, history, sort, filter]);
  const filters = useMemo<LibraryFilter[]>(() => ['all', ...PLATFORMS.filter((p) => allGames.some((g) => g.platform === p))], [allGames]);

  const [zone, setZone] = useState<Zone>('row');
  const [pressed, setPressed] = useState(false);
  const [origin, setOrigin] = useState<LaunchOrigin | null>(null);
  const [menu, setMenu] = useState<null | { kind: 'options' } | { kind: 'graphics' } | { kind: 'art'; results: ArtSearchResult[] | null; error?: string }>(null);
  const [setupIndex, setSetupIndex] = useState(0);
  const steps = useSetupSteps();
  const openSettings = useStore((s) => s.openSettings);
  const row = useRef<GameRowHandle>(null);

  const index = Math.max(0, games.findIndex((g) => g.id === focusedGameId));
  const game = games[index] ?? null;
  const art = useMemo(() => (game ? placeholderArt(game) : null), [game]);
  const gameArt = game ? artMap[game.id] : undefined;
  const heroBackground = gameArt?.hero ? `url("${gameArt.hero}") center / cover no-repeat, ${art?.hero}` : (art?.hero ?? 'linear-gradient(120deg,#0b0d14,#05060a)');

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
      const cover = artMap[g.id]?.grid;
      if (rect) setOrigin({ rect, background: cover ? `url("${cover}") center / cover no-repeat` : placeholderArt(g).tile });
      const result = await api.invoke('game:launch', { gameId: g.id });
      if (!result.ok) {
        play('error');
        setOrigin(null);
        toast({ level: 'error', title: `Couldn't start ${g.displayTitle}`, ...(result.error ? { detail: result.error } : {}) });
      }
      for (const w of result.warnings) toast({ level: 'warn', title: w });
    },
    [games, session.kind, toast, artMap],
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
        } else if (allGames.length === 0) {
          play('confirm');
          openSettings(steps[setupIndex]?.id ?? 'emulators');
        } else if ((zone === 'row' || zone === 'play') && games.length > 0) {
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
        case 'filterPrev':
        case 'filterNext': {
          if (e.kind !== 'press' || filters.length < 2) return true;
          const current = useStore.getState().settings?.ui.filter ?? 'all';
          const at = filters.indexOf(current);
          // A saved filter for a console that's no longer in the library steps back to All.
          const next = at === -1 ? 'all' : filters[(at + (e.action === 'filterNext' ? 1 : -1) + filters.length) % filters.length]!;
          play('tab');
          setZone('row');
          void updateSettings({ ui: { filter: next } });
          // Start the filtered row at its first (most recently played) game.
          setFocusedGame(arrangeLibrary(allGames, history, sort, next)[0]?.id ?? null);
          return true;
        }
        case 'menu':
          if (e.kind === 'press' && game) {
            play('confirm');
            setMenu({ kind: 'options' });
          }
          return true;
        case 'up':
          if (allGames.length === 0 && zone === 'row' && setupIndex > 0) {
            setSetupIndex(setupIndex - 1);
            play('move');
            return true;
          }
          if (zone === 'play') setZone('row');
          else if (zone === 'row') setZone('tabs');
          else return true;
          play('move');
          return true;
        case 'down':
          if (allGames.length === 0 && zone === 'row') {
            if (setupIndex < steps.length - 1) {
              setSetupIndex(setupIndex + 1);
              play('move');
            }
            return true;
          }
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
    [zone, games.length, allGames, history, sort, filter, filters, index, game, focusIndex, launch, setScreen, openSettings, steps, setupIndex, updateSettings, setFocusedGame],
  );

  useInputHandler(handle);

  // Input can drop mid-press (focus loss, a game starting): clear the pressed look.
  useEffect(() => {
    const clear = (): void => setPressed(false);
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);
  useEffect(() => setPressed(false), [session.kind]);

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
  const played = game ? history[gameKey(game)] : undefined;

  function gameMenu(): MenuItem[] {
    if (!game) return [];
    const hasKey = !!settings?.metadata.steamGridDbKey;
    const artError = (e: Error): void => toast({ level: 'error', title: 'Artwork', detail: e.message });
    return [
      { label: 'Play', run: () => void launch(index) },
      {
        label: 'Choose artwork…',
        detail: hasKey ? 'Pick the right game on SteamGridDB' : 'Add a SteamGridDB key in Settings → Artwork first',
        disabled: !hasKey,
        run: () => {
          setMenu({ kind: 'art', results: null });
          api
            .invoke('art:search', { gameId: game.id })
            .then((results) => setMenu({ kind: 'art', results }))
            .catch((e: Error) => setMenu({ kind: 'art', results: [], error: e.message }));
        },
      },
      { label: 'Refresh artwork', detail: hasKey ? undefined : 'Free box art. Add a SteamGridDB key for backgrounds and logos too', run: () => void api.invoke('art:refresh', { gameId: game.id }).catch(artError) },
      ...(!['dolphin', 'ryubing', 'xemu'].includes(game.emulator) || settings?.customEmulators[game.platform] ? [] : [{
        label: 'Graphics for this game…',
        detail: settings?.gameGraphics[gameKey(game)] ? 'Custom settings' : 'Uses your default graphics settings',
        run: () => setMenu({ kind: 'graphics' }),
      }]),
      ...(() => {
        const preset = presetFor(game.platform, game.gameId);
        return preset
          ? [{ label: `${preset.name} controls`, detail: 'This game has its own button layout', run: () => toast({ level: 'info', title: `${preset.name} controls`, detail: preset.controls.join('\n') }) }]
          : [];
      })(),
      { label: 'Show in Finder', detail: game.discPaths ? `${game.discPaths.length} discs · ${game.path}` : game.path, run: () => void api.invoke('game:reveal', { gameId: game.id }) },
    ];
  }

  return (
    <div className="screen home">
      <HeroBackground artKey={`${game?.id ?? 'empty'}-${gameArt?.hero ?? ''}`} background={heroBackground} drift={!!settings?.ui.backgroundDrift} />
      <TopBar focusedTab={zone === 'tabs' ? 'settings' : null} />

      {filters.length > 1 && (
        <div className="filters" aria-label="Filter by console">
          <LayoutGlyph button="LT" />
          {filters.map((f) => (
            <span key={f} className="filter" data-active={f === filter}>
              {f === 'all' ? 'All' : PLATFORM_INFO[f].label}
            </span>
          ))}
          <LayoutGlyph button="RT" />
        </div>
      )}

      {games.length > 0 ? (
        <GameRow ref={row} games={games} art={artMap} focusedIndex={index} active={zone === 'row'} onHover={() => setZone('row')} onActivate={(i) => (i === index ? void launch(i) : focusIndex(i))} />
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
            {gameArt?.logo ? (
              <h1 className="hero-logo-wrap">
                <img className="hero-logo" src={gameArt.logo} alt={game.displayTitle} draggable={false} />
              </h1>
            ) : (
              <h1 className="hero-title">{gameName(game, gameArt)}</h1>
            )}
            {game.note && <p className="hero-note">{game.note}</p>}
            <div className="hero-meta">
              {[
                game.gameId,
                game.format.toUpperCase(),
                game.discPaths ? `${game.discPaths.length} discs` : formatSize(game.sizeBytes),
                EMULATOR_LABEL[game.emulator],
                game.discNumber > 0 && !game.discPaths ? `Disc ${game.discNumber + 1}` : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </div>
            {played && (
              <div className="hero-played">
                Played {formatPlayTime(played.totalMs)} · last played {formatLastPlayed(played.lastPlayed)}
              </div>
            )}
            <button className="play" data-focused={zone === 'play'} data-pressed={pressed && zone === 'play'} onClick={() => void launch(index)}>
              Play
            </button>
          </>
        ) : allGames.length > 0 ? (
          <>
            <h1 className="hero-title">No {filter === 'all' ? '' : PLATFORM_INFO[filter].label} games</h1>
            <p className="hero-meta">Use the L and R triggers to choose another console.</p>
          </>
        ) : (
          <>
            <h1 className="hero-title">{scan ? 'Looking for games…' : 'Welcome to Arcadia'}</h1>
            <p className="hero-meta">{scan ? `${scan.scanned} of ${scan.total} files checked` : 'Three steps and you’re playing.'}</p>
            {!scan && <SetupChecklist steps={steps} focused={zone === 'row' ? setupIndex : -1} />}
          </>
        )}
      </section>

      {scan && games.length > 0 && <div className="scan-chip">Updating library · {scan.scanned}/{scan.total}</div>}

      <ButtonHints
        hints={[
          ...(zone === 'tabs' || games.length || allGames.length === 0 ? [{ button: 'south' as const, label: zone === 'tabs' ? 'Open' : games.length ? 'Play' : 'Set up' }] : []),
          ...(games.length && zone !== 'tabs' ? [{ button: 'menu' as const, label: 'Options' }] : []),
          ...(filters.length > 1 ? [{ button: 'RT' as const, label: 'Filter' }] : []),
          ...(zone !== 'row' ? [{ button: 'east' as const, label: 'Back' }] : []),
          { button: 'R', label: 'Settings' },
        ]}
      />

      <LaunchOverlay origin={origin} session={session} onClosed={() => setOrigin(null)} />
      {menu?.kind === 'graphics' && game && <GameGraphics game={game} title={gameName(game, gameArt)} onClose={() => setMenu(null)} />}
      {menu?.kind === 'options' && game && <ActionMenu title={gameName(game, gameArt)} items={gameMenu()} onClose={() => setMenu(null)} />}
      {menu?.kind === 'art' && game && (
        <ActionMenu
          title="Choose artwork"
          onClose={() => setMenu(null)}
          items={(menu.results ?? []).map<MenuItem>((r) => ({
            label: r.name,
            ...(r.year ? { detail: String(r.year) } : {}),
            run: () =>
              void api
                .invoke('art:refresh', { gameId: game.id, sourceId: r.id })
                .catch((e: Error) => toast({ level: 'error', title: 'Artwork', detail: e.message })),
          }))}
        >
          <p className="menu-intro">{menu.error ?? (menu.results === null ? 'Searching SteamGridDB…' : menu.results.length ? `Matches for “${game.displayTitle}”` : 'No matches found.')}</p>
        </ActionMenu>
      )}
    </div>
  );
}
