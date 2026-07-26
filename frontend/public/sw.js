/* Apollon service worker — background push + notification handling.
 *
 * This runs OUTSIDE any page, in its own context the browser owns. It has no
 * access to the DOM, React, or the app's memory, keeps no state between events
 * (the browser terminates and restarts it at will), and communicates only
 * through events. That is exactly why a notification can arrive and display when
 * no tab is open: the browser's push service wakes this worker on a `push`
 * event, the worker shows the notification, and the browser lets it sleep again.
 *
 * Served from /sw.js (root of the origin) so its scope is the whole app.
 * Plain JS on purpose — it is not part of the Vite/TS bundle; it is a static
 * asset the browser loads directly, so it must not import from `src/`.
 */

// Take control promptly on install/activate so an updated worker starts handling
// events without waiting for every tab to close first.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const DEFAULT_URL = '/dashboard';

// A push arrived. The backend sends a JSON body of { title, body, url }; the
// url is where a click should land. We read it defensively — a malformed or
// empty payload must still produce a sane, non-crashing notification.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Apollon';
  const options = {
    body: payload.body || '',
    // Large icon (the Apollo figure) and the monochrome badge (the sun), both
    // from the Task 1.4 icon set.
    icon: '/icons/notification-icon.png',
    badge: '/icons/notification-badge.png',
    // Carried through to the click handler for the deep link.
    data: { url: payload.url || DEFAULT_URL },
  };

  // waitUntil keeps the worker alive until the notification is actually shown —
  // without it the browser may kill the worker before showNotification resolves.
  event.waitUntil(self.registration.showNotification(title, options));
});

// The user activated a notification. Open the deep link, but prefer focusing an
// app window that is already open over spawning a duplicate tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = (event.notification.data && event.notification.data.url) || DEFAULT_URL;
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windows) {
        // Same-origin window already open — focus it (and navigate it to the
        // deep link if it is elsewhere) instead of opening a new one.
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ('navigate' in client && client.url !== targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Some browsers disallow navigate(); focusing is enough.
            }
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});
