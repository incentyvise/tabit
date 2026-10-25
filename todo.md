# Todo

## PWA Improvements

### Done

- [x] Web App Manifest (`id`, `display_override`, `orientation`, maskable icon)
- [x] Service worker: Workbox precache, navigation denylist, `offline.html` fallback, `cleanupOutdatedCaches()`
- [x] Maskable icon variant (`icon-maskable-512x512.png`)
- [x] Install prompt handling (`beforeinstallprompt` in onboarding)
- [x] Service worker update prompt (`src/lib/sw-update.ts`)
- [x] Offline detection UI (`OfflineBanner` under the top bar)
- [x] Push notifications; background sync for friend/invite responses (offline queue)
- [x] Self-hosted Inter font (precached Latin subsets)
- [x] Pinch-zoom allowed; inputs kept at ≥16px on touch devices to avoid iOS focus-zoom
- [x] Safe area: horizontal insets for landscape notches, `--safe-*` CSS variables, no `constant()` fallback
- [x] Route view transitions (respects reduced motion)

### Open

- [ ] Device test of the update cycle on an iOS home-screen install (see `docs/pwa-update-investigation.md` → Verification)
- [ ] Build and run the Docker images (retained-assets volume) end to end
- [ ] Offline queue only covers friend/tab-invite responses; queue expense/settlement mutations if offline editing is wanted

### Decided against

- `apple-mobile-web-app-status-bar-style: black-translucent`: the status bar icons are white, so in light mode they would be unreadable over the light top nav. Keep `black` unless the status bar style is switched per theme.
