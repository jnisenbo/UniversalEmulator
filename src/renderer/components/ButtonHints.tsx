import type { ReactNode } from 'react';
import { resolveButton, type ButtonLayout, type PadButton } from '@shared/controls';
import { useStore } from '../state/store';
import { FaceGlyph, MenuGlyph, ShoulderGlyph, TriggerGlyph, type FaceButton } from './Glyph';

export type HintButton = FaceButton | 'L' | 'R' | 'LT' | 'RT' | 'menu';

/**
 * A hint names the button by its default position; what's drawn is whichever
 * physical button drives that position in the user's layout.
 */
export interface Hint {
  button: HintButton;
  label: string;
}

const SLOT_OF: Record<HintButton, PadButton> = {
  south: 'south', east: 'east', west: 'west', north: 'north',
  L: 'l1', R: 'r1', LT: 'l2', RT: 'r2', menu: 'options',
};
const GLYPH_OF: Partial<Record<PadButton, HintButton>> = {
  south: 'south', east: 'east', west: 'west', north: 'north',
  l1: 'L', r1: 'R', l2: 'LT', r2: 'RT', options: 'menu',
};

export function remapHint(layout: ButtonLayout, button: HintButton): HintButton {
  return GLYPH_OF[resolveButton(layout, SLOT_OF[button])] ?? button;
}

/** Glyph for a default-position button, following the current layout. */
export function LayoutGlyph({ button }: { button: HintButton }) {
  const layout = useStore((s) => s.settings?.controller.layout ?? {});
  return <HintGlyph button={remapHint(layout, button)} />;
}

/** Bottom-right wayfinding: what each button does on this screen, always visible. */
export function ButtonHints({ hints, children }: { hints: Hint[]; children?: ReactNode }) {
  return (
    <div className="hints" role="note">
      {children}
      {hints.map((h) => (
        <span key={h.button + h.label} className="hint">
          <LayoutGlyph button={h.button} />
          {h.label}
        </span>
      ))}
    </div>
  );
}

export function HintGlyph({ button }: { button: HintButton }) {
  if (button === 'L' || button === 'R') return <ShoulderGlyph side={button} />;
  if (button === 'LT' || button === 'RT') return <TriggerGlyph side={button === 'LT' ? 'L' : 'R'} />;
  if (button === 'menu') return <MenuGlyph />;
  return <FaceGlyph button={button} />;
}

