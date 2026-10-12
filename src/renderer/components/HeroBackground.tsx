import { useEffect, useState } from 'react';

interface Layer {
  key: string;
  background: string;
}

/**
 * Full-bleed art for the focused game. New art fades in over the old one with
 * a slight settle in scale; no looping motion (vestibular safety).
 */
export function HeroBackground({ artKey, background, drift }: { artKey: string; background: string; drift: boolean }) {
  const [layers, setLayers] = useState<Layer[]>([{ key: artKey, background }]);

  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1]?.key === artKey ? prev : [...prev.slice(-1), { key: artKey, background }]));
  }, [artKey, background]);

  return (
    <div className="hero-bg" data-drift={drift} aria-hidden>
      {layers.map((l, i) => (
        <div key={l.key} className="hero-layer" data-entering={i === layers.length - 1 && layers.length > 1} style={{ background: l.background }} />
      ))}
      <div className="hero-scrim" />
    </div>
  );
}
