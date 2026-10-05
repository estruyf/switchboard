import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// Focus rings only while navigating with Tab; any pointer use hides them again (see styles.css).
const root = document.documentElement;
window.addEventListener('keydown', (event) => event.key === 'Tab' && root.setAttribute('data-keyboard-nav', ''), true);
window.addEventListener('pointerdown', () => root.removeAttribute('data-keyboard-nav'), true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
