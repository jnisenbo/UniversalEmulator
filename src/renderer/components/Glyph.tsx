/**
 * Generic, original button glyphs. Face buttons are a diamond of four dots
 * with the one to press filled in: position, not shape, so they read the
 * same on any controller.
 */
export type FaceButton = 'south' | 'east' | 'west' | 'north';

const POS: Record<FaceButton, [number, number]> = {
  north: [12, 5],
  east: [19, 12],
  south: [12, 19],
  west: [5, 12],
};

export function FaceGlyph({ button, size = '1.3em' }: { button: FaceButton; size?: string }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {(Object.keys(POS) as FaceButton[]).map((b) => {
        const [cx, cy] = POS[b];
        return b === button ? (
          <circle key={b} cx={cx} cy={cy} r={4.2} fill="currentColor" />
        ) : (
          <circle key={b} cx={cx} cy={cy} r={2.6} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.4} />
        );
      })}
    </svg>
  );
}

export function ShoulderGlyph({ side }: { side: 'L' | 'R' }) {
  return (
    <span className="glyph glyph-shoulder" aria-hidden>
      {side}
    </span>
  );
}

export function DpadGlyph({ size = '1.3em' }: { size?: string }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}
