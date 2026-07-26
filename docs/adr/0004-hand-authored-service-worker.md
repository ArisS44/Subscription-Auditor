# ADR 0004: Hand-authored service worker instead of vite-plugin-pwa

## Status
Accepted

## Context
The app needs a service worker for Web Push (background `push` + `notificationclick`) and a web app
manifest to be installable — the latter being the prerequisite for iOS Web Push. The common way to add
both to a Vite app is `vite-plugin-pwa` (Workbox under the hood), which generates a service worker, wires
precaching, and injects the manifest.

But what this project actually needs from the service worker is narrow and specific: display a push
payload and route a click. It needs **no** offline precaching, no runtime caching strategies, no asset
revisioning — the things Workbox exists to provide. Pulling in `vite-plugin-pwa` + Workbox would add a
build-time dependency and a generated worker whose caching behaviour we would then have to understand and
constrain, to obtain two event handlers we can write in ~60 lines.

## Decision
Hand-author a plain service worker at `frontend/public/sw.js`, served as a static asset at the origin
root (giving it whole-app scope), handling only `push` and `notificationclick`. Author the manifest by
hand as `public/manifest.webmanifest` and link it from `index.html`. Register the worker on load in
`main.tsx` (and again on demand in the opt-in). No PWA plugin, no Workbox, no precache.

## Consequences
- The worker deliberately has **no `fetch` handler and no Cache API use** — it never intercepts requests
  or serves assets, so it cannot serve a stale app shell or a stale favicon. Asset freshness stays wholly
  the browser/CDN's concern, which is the behaviour we want while iterating.
- One less build dependency and no generated code to audit; the worker is small enough to read in full and
  reason about directly, which also served the session's teaching goal (the service-worker execution model
  is a first-time concept here).
- If real offline support or precaching is ever wanted, that is a genuine reason to revisit this and adopt
  `vite-plugin-pwa` then — at which point the caching behaviour is the feature, not incidental weight.
- The trade-off is that we own the registration and update lifecycle by hand. It is minimal
  (`skipWaiting` + `clients.claim`), but it is ours to maintain rather than the plugin's.
