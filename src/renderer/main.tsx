import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installInput } from './input/input';
import { bootstrap } from './state/store';
import './styles.css';

installInput();
void bootstrap();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
