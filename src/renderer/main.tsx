import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OverlayApp } from './overlay/OverlayApp';
import { installInput } from './input/input';
import { bootstrap, useStore } from './state/store';
import './styles.css';

const isOverlay = location.hash === '#overlay';
installInput();
void bootstrap({ overlay: isOverlay });
function OverlayGate() {
  return useStore((s) => s.ready) ? <OverlayApp /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? <OverlayGate /> : <App />}
  </StrictMode>,
);
