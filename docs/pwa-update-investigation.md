# PWA update mechanism: investigation (2026-10)

Symptoms reported: after a deploy, users who installed Tab to the iOS home
screen (1) are sometimes never prompted to update, and (2) sometimes hit a
"404".

## How updates work today

- `src/sw.ts` (Workbox `injectManifest`) precaches the whole build, including
  `index.html`, and serves every navigation from the precached shell
  (cache-first). The new SW only takes over when the page posts
  `SKIP_WAITING`.
- `UpdateBannerProvider` (`app/(app)/context/update-banner-context.tsx`) calls
  `useRegisterSW` (vite-plugin-pwa → workbox-window). It checks for a new
  `sw.js` 3s after registration, when the page becomes visible, and every 15
  minutes. When a new SW is waiting, `needRefresh` opens the "Update
  available" dialog.
- "Update now" posts `SKIP_WAITING`, reloads on `controllerchange`, and
  **reloads anyway after 3s**.

## Why users aren't prompted

| # | Cause | Effect on iOS |
|---|-------|---------------|
| P1 | **After an update, update checks are switched off for the rest of that page's life.** `applyUpdate` sets `sessionStorage["tab-sw-just-updated"]`. After the reload, `onRegisteredSW` sees the flag, removes it and `return`s *before* it installs the startup / visibility / interval checks. | A home-screen app is usually resumed, not relaunched, and can stay alive for days. A user who accepted one update gets no further prompts until iOS kills the app. This is the most likely cause of "doesn't prompt". |
| P2 | Registration and update checks only exist inside `_authenticated` (`UpdateBannerProvider` is mounted by the authenticated layout). | `/login`, `/signup` and `/invite` never register the SW or check for updates, and the dialog can't show there. |
| P3 | The only signals are `visibilitychange`, a 15-minute `setInterval` and one check at startup. | iOS suspends timers in the background, so after a resume the interval is effectively dead. An SPA never navigates, so the browser's own navigation-time update check never runs. There's no check on route changes, `online` or `pageshow`. |
| P4 | The vite-plugin-pwa wrapper registers on `load` with its own Workbox instance, and the provider wires extra listeners onto the raw registration. | Remounting the provider leaves orphaned listeners and timers behind (it's mitigated with a cleanup ref, but fragile). |

## Why users hit a "404"

The server image only contains the **current** build's hashed assets. Any page
still running an older build can't fetch its own chunks from the server.

| # | Cause | Effect |
|---|-------|--------|
| F1 | **Reload race in "Update now".** If the new SW hasn't taken control within 3s, the page reloads under the *old* SW and gets the old `index.html`. The new SW then activates, deletes the old precache entries and claims the page (`clientsClaim`). | Every route chunk the old page lazy-loads afterwards misses the cache, goes to the network and 404s. TanStack Router shows a route error / blank screen. |
| F2 | **New SW takes control of an already-open old page.** For example, the user accepts the update in one window while another is still open, or iOS activates the waiting SW while an old document is still alive. Nothing listens for `controllerchange` outside `applyUpdate`. | Same as F1: old page, new precache, chunks 404. |
| F3 | **iOS evicts Cache Storage** (storage pressure, "Clear History and Website Data") while the SW registration survives. Workbox falls back to the network for precache misses. | The old shell is served from the network as the *new* `index.html`, which is fine, but any partially evicted old chunk 404s. There's no `navigator.storage.persist()` request to reduce eviction. |
| F4 | **Stale shell + new deep links.** Navigations are served from the precached `index.html`, so a push notification (`clients.navigate` / `openWindow`) or a shared link to a route added in a newer build renders the **app's own NotFound page** inside the old build. | This shows up as a "404" that nginx never served. It's especially common right after a deploy, when notifications link to new screens. |
| F5 | No handling of `vite:preloadError`. | Every chunk failure above is a dead end instead of self-healing with one reload. |

## Other best-practice gaps (2026)

- `workbox.navigateFallbackDenylist` in `vite.config.ts` has no effect with
  `injectManifest`. The SW's `NavigationRoute` has no denylist.
- Manifest: no `id` (identity is derived from `start_url`), no maskable icon
  (`purpose`) for Android adaptive icons, no `display_override`, no
  `orientation`. `apple-touch-icon` is 192px; iOS uses 180px.
- The Inter font comes from Google Fonts. It isn't precached or runtime-cached,
  so it fails offline and blocks first paint on slow networks.
- `maximum-scale=1, user-scalable=no` in the viewport disables zoom, which is
  an accessibility problem. iOS mostly ignores it, but Android doesn't. Left
  unchanged: it's a product decision.

## Fix plan (2026 best practices) — implemented on `fix/pwa-update-mechanism`

Principles: (a) a page must never run code from a different build than the
service worker that controls it; (b) the user is told about an update quickly
and applies it with one tap; (c) if the client still ends up on a stale build,
it heals itself with at most one reload; (d) the server keeps serving recently
retired assets so old clients degrade gracefully.

| Step | Change | Fixes |
|------|--------|-------|
| 1 | `src/lib/sw-update.ts`: single module-level registration (vite-plugin-pwa `registerSW`, prompt mode) started from `main.tsx`, state in a zustand store. `useUpdateBanner()` reads the store; the dialog renders in the root route so it works on every page (login/invite/onboarding included). The `sessionStorage` "just updated" kill-switch is gone. | P1, P2, P4 |
| 2 | Update checks on startup, `visibilitychange`→visible, `pageshow` (bfcache/iOS resume), `online`, `focus`, every router `onResolved` (screen change) and a 30-min interval — all through one throttle (≥60s apart, skipped offline or while a worker is installing). A worker already `waiting` re-opens the prompt instead of re-checking. | P3 |
| 3 | Global `controllerchange` guard: if the page already had a controller and a different worker takes over, reload exactly once. "Update now" posts `SKIP_WAITING` and lets that guard reload; the only fallback is a 10s reload when the waiting worker has gone redundant. | F1, F2 |
| 4 | `vite:preloadError` handler + router `defaultOnCatch`-style recovery: fetch the latest SW, activate it if one is waiting, then reload — at most once per 30s via `sessionStorage` timestamp so a genuinely broken deploy can't loop. | F3, F5 |
| 5 | NotFound page asks the SW for a newer build first; if one exists it activates + reloads, otherwise shows 404. | F4 |
| 6 | `navigator.storage.persist()` once per install when running standalone and signed in. | F3 |
| 7 | SW: navigation denylist for `/rpc`, `/api`, `/healthz`; runtime caching for Google Fonts (stylesheet stale-while-revalidate, font files cache-first). Removed the no-op `workbox.navigateFallbackDenylist` from `vite.config.ts`. | gaps |
| 8 | Manifest: `id`, `display_override`, `orientation`, `categories`, separate padded `maskable` icon; 180px `apple-touch-icon`. | gaps |
| 9 | nginx keeps retired hashed assets: on container start a `docker-entrypoint.d` script copies `/assets/*` into a persistent volume and prunes files older than 14 days; `/assets/` misses fall back to that volume. Compose mounts `pwa-assets`. | F1–F3 for clients without the new code |

Follow-up (2026-10): `user-scalable=no` / `maximum-scale=1` removed from the
viewport; inputs stay at ≥16px on touch devices so iOS doesn't zoom on focus.
Inter is now self-hosted (the Google Fonts stylesheet was loaded but never
applied, because `--font-inter` was undefined).

### Verification

- `tsc`, `eslint` (no new warnings) and `vite build` pass; the built `sw.js`
  contains the denylist, font routes and `SKIP_WAITING` handler; the bundle
  contains the `vite:preloadError` handler; the manifest has `id`, maskable
  icon and `display_override`.
- `docker/retain-assets.sh` was dry-run against temp dirs (copies current,
  keeps recent, prunes expired).
- **Not verified:** a real update cycle on an iOS home-screen install and the
  Docker image (the embedded test browser refuses SW registration; no local
  Docker). Suggested device test: install, deploy build A→B, resume the app —
  the prompt should appear within a minute of foregrounding; tap "Update now"
  — one reload into B; then deploy C without relaunching — prompt again.
