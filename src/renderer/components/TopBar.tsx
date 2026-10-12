import { useEffect, useState } from 'react';
import type { Screen } from '../state/store';
import { useStore } from '../state/store';
import { LayoutGlyph } from './ButtonHints';

const TABS: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Library' },
  { id: 'settings', label: 'Settings' },
];

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

function Battery() {
  const pad = useStore((s) => s.controller.controllers[0]);
  if (!pad || pad.battery === null) return null;
  const pct = Math.round(pad.battery * 100);
  return (
    <span className="battery" title={`${pad.name}: ${pct}%`}>
      <span className="battery-body">
        <span className="battery-fill" style={{ width: `${pct}%` }} data-low={pct <= 15} />
      </span>
      {pad.charging && <span className="battery-bolt">⚡︎</span>}
    </span>
  );
}

/** Translucent floating bar. `focusedTab` is set when focus is in the bar. */
export function TopBar({ focusedTab }: { focusedTab: Screen | null }) {
  const screen = useStore((s) => s.screen);
  return (
    <header className="topbar">
      <div className="brand">Arcadia</div>
      <nav className="tabs">
        <LayoutGlyph button="L" />
        {TABS.map((t) => (
          <span key={t.id} className="tab" data-active={screen === t.id} data-focused={focusedTab === t.id}>
            {t.label}
          </span>
        ))}
        <LayoutGlyph button="R" />
      </nav>
      <div className="status">
        <Battery />
        <Clock />
      </div>
    </header>
  );
}
