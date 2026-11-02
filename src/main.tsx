import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DesktopPresence from './DesktopPresence';
import AppUpdate from './AppUpdate';
import { WorkspaceGate } from './WorkspaceLock';
import './styles.css';
import './theme.css';
import './design-system.css';
import './connected-shell.css';

const overlay = location.hash === '#/voice-overlay';
// Read-only feature marker for native navigation. No native privileges or data.
Object.defineProperty(window, '__jarvisFeatures', { value: Object.freeze({ devices: 1, cameraCheckins: 1 }), configurable: true });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><WorkspaceGate lockedView={overlay ? <DesktopPresence locked /> : undefined}>{overlay ? <DesktopPresence /> : <App />}</WorkspaceGate>{!overlay && <AppUpdate />}</React.StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      window.dispatchEvent(new CustomEvent('offline-unavailable'));
    });
  });
}
