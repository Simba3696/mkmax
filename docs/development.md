# Development

## Setup

```sh
npm install
npm run dev       # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test          # Vitest unit tests
npm run lint      # oxlint (correctness rules and React hooks rules)
npm run build     # type-check and production build in dist/ (installable PWA)
npm run catalog   # refresh public/catalog.json from MK Mobile Base
npm run events    # refresh public/events.json from MK Mobile Base
```

## Linting

`npm run lint` runs [oxlint](https://oxc.rs/docs/guide/usage/linter) with `.oxlintrc.json`, and the deploy workflow runs it before the tests. It's oxlint rather than ESLint because typescript-eslint doesn't support TypeScript 7 yet. The config turns on the correctness rules plus `rules-of-hooks` and `exhaustive-deps`. It turns off `react/refs`, because the app uses the "latest ref" pattern (a ref updated during render so effects see the newest callback) on purpose, and `react/set-state-in-effect`.

## Project layout

| Path | What's in it |
|---|---|
| `src/engine.ts` | Scoring, the purchase planner, pack ranking and the Fusion Up Kard plan |
| `src/normalize.ts` | Save-file migrations (`AppState.version`) |
| `src/store.tsx` | App state, undo, and localStorage persistence |
| `src/sync.ts` | GitHub Gist sync |
| `src/catalog.ts`, `src/wiki.ts` | Card art and rarity lookups (MK Mobile Base, MK Mobile wiki) |
| `src/events.ts` | Event schedule: shop packs, Elder challenges, Realm Klash seasons |
| `src/cardList.ts` | The **Paste a list…** parser |
| `src/ui.tsx` | Shared components: `NumInput`, `ConfirmButton`, `FoldCard`, `useDeviceChoice` (per-device settings like sort order) |
| `src/views/` | One component per tab, plus the pack editor and sync panel |
| `scripts/` | Build-time fetchers for the catalog and the event schedule |
| `public/` | Icons, the bundled catalog and schedule, and the OneNote starter data |

## Saved data and migrations

The saved state carries a `version`. When the shape or meaning of saved data changes, bump the version in `src/types.ts`, `src/defaults.ts` and `src/normalize.ts`, and add a step to `normalize()` that runs once for older saves. A migration runs only once, so a change the user makes afterwards (deleting a rarity, removing a tag) sticks.

**Builds from before 2026-09-28.** Builds from before 12:30 that day (commit `19ef952`) treated newer saved data as the old F1-based format and raised every level by one when they synced. A card at F9 then reached F10 and was removed. Current builds never pull data from one of those builds (it's saved as version 2); they upload their own copy over it and show a sync error telling you to reopen MK Max on your other devices so they update. The same bug gave the Kameo rarities a fusion step, so owning a Kameo no longer counted as done; loading the app now takes that step back off.

## Hosting

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests and builds the app, then publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`. In the repo settings, set **Pages → Source** to **GitHub Actions** first. On the free plan, Pages needs a public repo.

## Layout

Only the content area scrolls; the header and tab bar are fixed rows around it, not bars floating over a scrolling page. iPhone Safari can strand floating bars mid-screen when the scroll position jumps during a scroll (as on a tab switch), and this layout avoids that.

## Screenshots

`docs/screenshots/` holds the README images: the sample data (Settings → Load sample data) at 390×844, 2× scale, in dark mode. Retake them when a screen changes noticeably.

## Icons

The icon is a gold-ringed red medallion with a double up-chevron. `public/icon.svg` is the source. The PNGs next to it are rendered from it: `icon-192.png` and `icon-512.png` for the manifest, `icon-maskable-512.png` (the mark padded for Android's crop), and `apple-touch-icon.png` (180px). `public/logo-mark.svg` is the medallion without its background tile, used in the header. If you change the design, re-render all four PNGs. Phones cache home-screen icons, so remove the app and add it again to see a new one.

The tab bar icons are inline SVGs in `src/icons.tsx`. They use the current text color, so the active tab's icon turns red.
