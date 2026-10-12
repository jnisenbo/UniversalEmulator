import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { PLATFORM_INFO } from '@shared/platforms';
import type { Game, GameArt } from '@shared/types';
import { monogram, placeholderArt } from '../art/placeholder';
import { onFrame } from '../engine/loop';
import { SPRINGS, Spring } from '../engine/spring';

/** Geometry in rem; converted to px at runtime so the row scales with the window. */
const TILE_REM = 8.5;
const GAP_REM = 1.1;
const FOCUS_SCALE = 1.38;

/** The focused tile stays partly raised while focus is elsewhere on the screen, so you keep your place. */
const growTarget = (i: number, focusedIndex: number, rowActive: boolean): number => (i !== focusedIndex ? 0 : rowActive ? 1 : 0.55);

export interface GameRowHandle {
  /** Move focus; `velocity` (px/s) is handed to the scroll spring for momentum moves. */
  focus(index: number, opts?: { velocity?: number; momentum?: boolean }): void;
  /** Bump against an end of the row: an impulse the spring absorbs and returns from. */
  bumpEdge(direction: -1 | 1): void;
  stridePx(): number;
  tileRect(index: number): DOMRect | null;
}

interface Props {
  games: Game[];
  art: Record<string, GameArt>;
  focusedIndex: number;
  /** Whether the row itself has focus (vs. top bar or Play button). */
  active: boolean;
  onHover(index: number): void;
  onActivate(index: number): void;
}

export const GameRow = forwardRef<GameRowHandle, Props>(function GameRow({ games, art: artMap, focusedIndex, active, onHover, onActivate }, ref) {
  const trackRef = useRef<HTMLDivElement>(null);
  const tileEls = useRef<(HTMLDivElement | null)[]>([]);
  const scroll = useRef(new Spring(0, SPRINGS.smooth));
  const grow = useRef<Spring[]>([]);
  const focused = useRef(focusedIndex);
  const activeRef = useRef(active);
  const remPx = useRef(16);
  const gamesRef = useRef(games);
  gamesRef.current = games;

  // One "grow" spring per tile: 0 = resting, 1 = focused.
  if (grow.current.length !== games.length) {
    grow.current = games.map((_, i) => grow.current[i] ?? new Spring(growTarget(i, focusedIndex, active), SPRINGS.snappy));
  }

  const stride = (): number => (TILE_REM + GAP_REM) * remPx.current;

  useImperativeHandle(ref, () => ({
    focus(index, opts = {}) {
      focused.current = index;
      scroll.current.setTarget(index * stride(), {
        ...(opts.velocity !== undefined ? { velocity: opts.velocity } : {}),
        config: opts.momentum ? SPRINGS.momentum : SPRINGS.smooth,
      });
      grow.current.forEach((s, i) => s.setTarget(growTarget(i, index, activeRef.current)));
    },
    bumpEdge(direction) {
      // Push the spring past its target; it resists and returns: a soft wall, not a hard stop.
      scroll.current.velocity += direction * 9 * remPx.current;
    },
    stridePx: stride,
    tileRect: (i) => tileEls.current[i]?.getBoundingClientRect() ?? null,
  }));

  useEffect(() => {
    activeRef.current = active;
    // Tiles stay large only while the row owns focus, like stepping back from a shelf.
    grow.current.forEach((s, i) => s.setTarget(growTarget(i, focused.current, active)));
  }, [active]);

  useEffect(() => {
    const measure = (): void => {
      remPx.current = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      scroll.current.jump(focused.current * stride());
    };
    measure();
    window.addEventListener('resize', measure);

    const tilePx = (): number => TILE_REM * remPx.current;
    let lastKey = '';
    let lastGames: unknown = null;
    const stop = onFrame('animate', (dt) => {
      const s = scroll.current;
      s.step(dt);
      let x = 0;
      let key = `${s.value.toFixed(2)}`;
      const growExtra = (FOCUS_SCALE - 1) * tilePx();
      for (let i = 0; i < grow.current.length; i++) {
        const g = grow.current[i]!;
        g.step(dt);
        key += `|${g.value.toFixed(3)}`;
      }
      // A new list (filter, re-sort, rescan) needs every tile placed again even if
      // no spring moved; the tile elements behind each index have changed.
      if (key === lastKey && gamesRef.current === lastGames) return;
      lastGames = gamesRef.current;
      lastKey = key;
      // Tiles before the focused one are offset by their own growth only, so the
      // focused tile stays anchored at the left and neighbours make room.
      for (let i = 0; i < grow.current.length; i++) {
        const g = grow.current[i]!.value;
        const el = tileEls.current[i];
        if (el) {
          el.style.transform = `translate3d(${x}px,0,0) scale(${1 + g * (FOCUS_SCALE - 1)})`;
          el.style.setProperty('--grow', g.toFixed(3));
        }
        x += stride() + g * growExtra;
      }
      if (trackRef.current) trackRef.current.style.transform = `translate3d(${-s.value}px,0,0)`;
    });
    return () => {
      stop();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (focused.current !== focusedIndex) {
      focused.current = focusedIndex;
      scroll.current.setTarget(focusedIndex * stride());
      grow.current.forEach((s, i) => s.setTarget(growTarget(i, focusedIndex, activeRef.current)));
    }
  }, [focusedIndex]);

  return (
    <div className="row-viewport" data-active={active}>
      <div className="row-track" ref={trackRef}>
        {games.map((g, i) => {
          const art = placeholderArt(g);
          const cover = artMap[g.id]?.grid;
          const info = PLATFORM_INFO[g.platform];
          return (
            <div
              key={g.id}
              ref={(el) => {
                tileEls.current[i] = el;
              }}
              className="tile"
              data-focused={i === focusedIndex}
              style={{ background: art.tile }}
              onPointerEnter={() => onHover(i)}
              onClick={() => onActivate(i)}
            >
              {cover ? <img className="tile-cover" src={cover} alt="" draggable={false} /> : <span className="tile-monogram">{monogram(g.displayTitle)}</span>}
              <span className="tile-platform">{info.short}</span>
              <span className="tile-title">{g.displayTitle}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
