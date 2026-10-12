import type { ReactNode } from 'react';
import { FaceGlyph, MenuGlyph, ShoulderGlyph, TriggerGlyph, type FaceButton } from './Glyph';

export interface Hint {
  button: FaceButton | 'L' | 'R' | 'LT' | 'RT' | 'menu';
  label: string;
}

/** Bottom-right wayfinding: what each button does on this screen, always visible. */
export function ButtonHints({ hints, children }: { hints: Hint[]; children?: ReactNode }) {
  return (
    <div className="hints" role="note">
      {children}
      {hints.map((h) => (
        <span key={h.button + h.label} className="hint">
          {h.button === 'L' || h.button === 'R' ? (
            <ShoulderGlyph side={h.button} />
          ) : h.button === 'LT' || h.button === 'RT' ? (
            <TriggerGlyph side={h.button === 'LT' ? 'L' : 'R'} />
          ) : h.button === 'menu' ? (
            <MenuGlyph />
          ) : (
            <FaceGlyph button={h.button} />
          )}
          {h.label}
        </span>
      ))}
    </div>
  );
}
