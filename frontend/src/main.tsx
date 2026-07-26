import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the push/notification service worker once the page has loaded, so it
// is active to receive pushes and handle notification clicks across reloads. The
// opt-in flow also ensures registration on demand; this just gets it in place
// early. Failure here is non-fatal — the opt-in will register on grant.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* no-op: registration is retried during opt-in */
    });
  });
}
