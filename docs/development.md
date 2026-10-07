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

For how these pieces fit together, see [Architecture](architecture.md). Guidance for coding agents is in [AGENTS.md](../AGENTS.md), with Claude Code skills and agents in `.claude/`.

| Path | What's in it |
|---|---|
| `src/engine.ts` | Scoring, the purchase planner, pack ranking and the Fusion Up Kard plan |
| `src/normalize.ts` | Save-file migrations (`AppState.version`) |
| `src/store.tsx` | App state, undo, and localStorage persistence |
| `src/storage.ts` | Reading the save at startup, and keeping a copy of one that can't be read |
| `src/sync.ts` | GitHub Gist sync: the API calls and which copy wins |
| `src/syncLoop.ts` | When to pull, push or ask, around requests that can overlap edits and disconnects |
| `src/catalog.ts`, `src/wiki.ts` | Card art and rarity lookups (MK Mobile Base, MK Mobile wiki) |
| `src/events.ts` | Event schedule: shop packs, Elder challenges, Realm Klash seasons |
| `src/cardList.ts` | The **Paste a list…** parser |
| `src/styles.css` | Tailwind theme tokens (`@theme`: colors, radii, text sizes) and the base styles for buttons, inputs and headings |
| `src/classes.ts` | Shared Tailwind class sets (`card`, `row`, `btn`, `form` and so on) |
| `src/ui.tsx` | Shared components: `Modal` (with a `wide` option), `Chip`, `CardThumb`, `RarityBadge`, `NumInput`, `ConfirmButton`, `FoldCard`, `useDeviceChoice` (per-device settings like sort order) |
| `src/views/` | One component per tab, plus the pack editor and sync panel |
| `scripts/` | Build-time fetchers for the catalog and the event schedule; `schedule.mjs` turns the schedule into `events.json` and is tested |
| `public/` | Icons, and the bundled catalog and schedule |

## Saved data and migrations

The saved state carries a `version`. When the shape or meaning of saved data changes, bump the version in `src/types.ts`, `src/defaults.ts` and `src/normalize.ts`, and add a step to `normalize()` that runs once for older saves. A migration runs only once, so a change the user makes afterwards (deleting a rarity, removing a tag) sticks. A file with no rarities at all gets the built-in ones before any migration runs, since some migrations add a rarity to the list and would leave it with only those. Sync never pulls or pushes data saved in a higher version than the build's own, and Import backup refuses such a file, so a device still on the old build can't save new data back in the old format and make the migration run again.

**Builds from before 2026-09-28.** Builds from before 12:30 that day (commit `19ef952`) treated newer saved data as the old F1-based format and raised every level by one when they synced. A card at F9 then reached F10 and was removed. Current builds never pull data from one of those builds (it's saved as version 2); they upload their own copy over it and show a sync error telling you to reopen MK Max on your other devices so they update. The same bug gave the Kameo rarities a fusion step, so owning a Kameo no longer counted as done; loading the app now takes that step back off.

## Hosting

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests and builds the app, then publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`. In the repo settings, set **Pages → Source** to **GitHub Actions** first. On the free plan, Pages needs a public repo.

The workflow also runs every day at 17:30 UTC to refresh the catalog and the event schedule. If either refresh fails, it warns and deploys the copy that's live again (`PAGES_URL` in the workflow), so check the run's warnings when the app's schedule date stops moving. GitHub turns off a public repo's scheduled workflows after 60 days without commits. The workflow then stops running, even on a push, and the schedule stops updating. To turn it back on, open the repo's **Actions** tab, pick **Deploy to GitHub Pages** and choose **Enable workflow**.

## Styling

Styles are [Tailwind CSS](https://tailwindcss.com/) v4 utilities, built by `@tailwindcss/vite` (a dev dependency; nothing ships at runtime). `src/styles.css` defines the theme and removes Tailwind's default palette, so only the app's own colors exist (`bg-panel`, `text-muted`, `border-line`, `text-gold` and so on). It also holds the base look of buttons, inputs, selects and headings.

Repeated looks live in `src/classes.ts` as class sets, such as `card` for a page section or `row` for a list row. Never put two utilities that set the same property (two paddings, two background colors) on one element at the same breakpoint: which one wins depends on Tailwind's output order, not on the order in `className`. Add spacing and layout around a class set rather than overriding it.

## Layout

Below `md` (768px) the app is the phone layout: a header, the page in a column up to 720px wide, and the tab bar at the bottom. From `md` the header goes and the tabs become a left rail, 88px wide with the labels under the icons, and 220px wide from `lg` (1024px). The page can then grow to 1400px, and views add columns at `md`, `lg` and `xl` where there's room. The rail comes after the page in the DOM and is moved first with `order-first`, so the tab order is the same on every screen size. Pop-ups are 640px wide at most; the pack editor uses `Modal`'s `wide` option to grow to 920px from `lg`.

Keep phones unchanged when working on wider screens: put desktop styles behind `md:` and up, and check the phone layout at 390×844.

Only the content area scrolls; the header and tab bar are fixed rows around it, not bars floating over a scrolling page. iPhone Safari can strand floating bars mid-screen when the scroll position jumps during a scroll (as on a tab switch), and this layout avoids that. Code that needs the scrolling area or a pop-up finds it by attribute, not by class: `scrollRoot.ts` looks for `[data-scroll-root]`, and pull to refresh and tab swiping ignore touches inside `[data-modal]`.

## Screenshots

`docs/screenshots/` holds the README images: the sample data (Settings → Load sample data) at 390×844, 2× scale, in dark mode. They're phone shots; there are no tablet or desktop ones. Retake them when a screen changes noticeably.

## Icons

The icon is a gold-ringed red medallion with a double up-chevron. `public/icon.svg` is the source. The PNGs next to it are rendered from it: `icon-192.png` and `icon-512.png` for the manifest, `icon-maskable-512.png` (the mark padded for Android's crop), and `apple-touch-icon.png` (180px). `public/logo-mark.svg` is the medallion without its background tile, used in the header and the side rail. If you change the design, re-render all four PNGs. Phones cache home-screen icons, so remove the app and add it again to see a new one.

The tab icons are inline SVGs in `src/icons.tsx`. They use the current text color, so the active tab's icon turns red.
