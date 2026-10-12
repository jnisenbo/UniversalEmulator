import type { ReactNode } from 'react';
import { FaceGlyph, MenuGlyph, ShoulderGlyph, type FaceButton } from './Glyph';

export interface Hint {
  button: FaceButton | 'L' | 'R' | 'menu';
  label: string;
}

/** Bottom-right wayfinding: what each button does on this screen, always visible. */
export function ButtonHints({ hints, children }: { hints: Hint[]; children?: ReactNode }) {
  return (
    <div className="hints" role="note">
      {children}
      {hints.map((h) => (
        <span key={h.button + h.label} className="hint">
          {h.button === 'L' || h.button === 'R' ? <ShoulderGlyph side={h.button} /> : h.button === 'menu' ? <MenuGlyph /> : <FaceGlyph button={h.button} />}
          {h.label}
        </span>
      ))}
    </div>
  );
}
