import { useEffect, useState } from 'react';
import { onInputActivity } from './input/input';
import { useInputHandler } from './input/useInput';
import { play } from './sound/sfx';
import { useStore } from './state/store';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { Toasts } from './components/Toasts';

export function App() {
  const ready = useStore((s) => s.ready);
  const screen = useStore((s) => s.screen);
  const [pointer, setPointer] = useState(false);

  // Bottom of the input stack: L/R switch between the top-level screens.
  useInputHandler((e) => {
    if (e.kind !== 'press') return false;
    if (e.action === 'tabPrev' || e.action === 'tabNext') {
      const next = e.action === 'tabNext' ? 'settings' : 'home';
      if (next !== useStore.getState().screen) {
        play('tab');
        useStore.getState().setScreen(next);
      } else play('edge');
      return true;
    }
    return false;
  });

  // Hide the cursor while the controller or keyboard is in use.
  useEffect(() => onInputActivity((source) => setPointer(source === 'pointer')), []);

  if (!ready) return <div className="boot" />;
  return (
    <div className="app" data-pointer={pointer}>
      <div className="screens">{screen === 'home' ? <Home /> : <Settings />}</div>
      <Toasts />
    </div>
  );
}
