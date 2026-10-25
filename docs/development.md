# Development

## Setup

```sh
npm install
npm run dev       # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test          # Vitest: engine and data tests, plus screen tests
npm run lint      # oxlint (correctness rules and React hooks rules)
npm run build     # type-check and production build in dist/ (installable PWA)
npm run catalog   # refresh public/catalog.json from MK Mobile Base
npm run events    # refresh public/events.json from MK Mobile Base
npx knip          # unused files, exports and dependencies (a dev tool; not run in CI)
```

## Linting

`npm run lint` runs [oxlint](https://oxc.rs/docs/guide/usage/linter) with `.oxlintrc.json`, and both workflows run it before the tests: `ci.yml` on every pull request and `deploy.yml` before every deploy. It's oxlint rather than ESLint because typescript-eslint doesn't support TypeScript 7 yet. The config turns on the correctness rules plus `rules-of-hooks` and `exhaustive-deps`. It turns off `react/refs`, because the app uses the "latest ref" pattern (a ref updated during render so effects see the newest callback) on purpose, and `react/set-state-in-effect`.

## Tests

Planning, scoring and saved-data logic is tested in plain `*.test.ts` files next to the code, mostly `src/engine.test.ts`. Screens are tested in `*.test.tsx` files with [Testing Library](https://testing-library.com/docs/react-testing-library/intro/) in jsdom: each starts with `// @vitest-environment jsdom`, so the logic tests keep running in Node. A screen test renders the real `StoreProvider` and `PlanProvider` with a save seeded in `localStorage`, stubs `fetch` so the catalog and event schedule stay offline, and clears `localStorage` afterwards. Testing Library, jsdom and yaml (which reads the GitHub workflows in `src/workflows.test.ts`) are dev dependencies; nothing of them ships. jsdom needs Node 22.22 or newer (24.15 or newer on Node 24), so update Node if the screen tests fail to start. Each test opens with a `// Value:` comment saying what it protects and what would make it fail.

## Project layout

For how these pieces fit together, see [Architecture](architecture.md). Guidance for coding agents is in [AGENTS.md](../AGENTS.md), with Claude Code skills and agents in `.claude/`.

| Path | What's in it |
|---|---|
| `src/engine.ts` | Scoring, the purchase planner, pack ranking and the Fusion Up Kard plan |
| `src/types.ts` | The saved data's shape (`AppState`) |
| `src/defaults.ts` | Built-in rarities and their Fusion Up Kard costs, default weights, a new install's data and the sample data |
| `src/challenges.ts` | The hand-kept list of Elder challenge characters, and the retired challenges whose Kameos now come from packs |
| `src/kaskets.ts` | The shop's Kaskets and their rarities, and the hand-kept list of newest cards Kaskets leave out (replaced each game update) |
| `src/normalize.ts` | Save-file migrations (`AppState.version`) |
| `src/store.tsx` | App state, undo, and localStorage persistence |
| `src/planner.tsx` | `PlanProvider` and `usePlan()`: the planner context and plan, worked out once and shared by every view |
| `src/storage.ts` | Reading the save at startup, keeping a copy of one that can't be read, and holding one from a newer version |
| `src/sync.ts` | GitHub Gist sync: the API calls and which copy wins |
| `src/appUpdate.ts` | The service worker and the new-version bar: when a new version counts as ready, and Reload switching to it |
| `src/syncLoop.ts` | When to pull, push or ask, around requests that can overlap edits and disconnects |
| `src/catalog.ts`, `src/wiki.ts` | Card art and rarity lookups (MK Mobile Base, MK Mobile wiki) |
| `src/names.ts` | Matching card names written different ways (`nameKey`, and the site's typos in `SITE_TYPOS`); kept apart from `catalog.ts` so the engine loads without React |
| `src/events.ts` | Event schedule: shop packs, Elder challenges, Realm Klash seasons |
| `src/cardList.ts` | The parser for **Paste a list…** and **Paste maxed cards…** |
| `src/styles.css` | Tailwind theme tokens (`@theme`: colors, radii, text sizes) and the base styles for buttons, inputs and headings |
| `src/classes.ts` | Shared Tailwind class sets (`card`, `row`, `btn`, `form` and so on) |
| `src/ui.tsx` | Shared components: `Modal` (with a `wide` option), `Chip`, `CardThumb`, `RarityBadge`, `NumInput`, `ConfirmButton`, `FoldCard`, `useDeviceChoice` (per-device settings like sort order), `kasketLine` (a Kasket's pool in words), and `kardNotes` and `kardFooter` (the Fusion Up Kard plan's notes in words) |
| `src/views/` | One component per tab, plus the pack editor, the Tower gear and Maxed pages, the card search (`CardPicker`, shared by the editor and a Kasket's pull step) and sync panel |
| `scripts/` | Build-time fetchers for the catalog and the event schedule; `schedule.mjs` turns the schedule into `events.json` and is tested |
| `public/` | Icons, and the bundled catalog and schedule |

## Saved data and migrations

The saved state carries a `version`. When the shape or meaning of saved data changes, bump the version in `src/types.ts`, `src/defaults.ts` and `src/normalize.ts`, and add a step to `normalize()` that runs once for older saves. A migration runs only once, so a change the user makes afterwards (deleting a rarity, removing a tag) sticks. A file with no rarities at all gets the built-in ones before any migration runs, since some migrations add a rarity to the list and would leave it with only those. Sync never pulls or pushes data saved in a higher version than the build's own, Import backup refuses such a file, and a save in the browser from a higher version is shown but never saved over (see [Architecture → State model](architecture.md#state-model)), so a device still on the old build can't save new data back in the old format and make the migration run again. A version can also be bumped with no migration step, when older builds would misread new data: version 16 added **No kards** on cards, which an older build would ignore, planning kards on those cards and deleting a No kards piece at F3, and version 17 added the Maxed record, a top-level field, which an older build would drop and sync back, since `normalize()` builds the saved state one field at a time. Every new top-level field needs a bump for that reason. That refusal only exists in builds from 2026-10-07 on; a device not opened since then could still pull newer data once before it updates. The hold on the browser's own save only exists in builds on version 17 and later. Never revert a version bump: a lower-version build from before version 17 would load and downgrade the newer saves already on each device, later ones would only show them and refuse every change, and the gist would stay on the higher version, so sync would stop until a build with that version ships. Fix forward instead.

**Builds from before 2026-09-28.** Builds from before 12:30 that day (commit `9d1ef68`) treated newer saved data as the old F1-based format and raised every level by one when they synced. A card at F9 then reached F10 and was removed. Current builds never pull data from one of those builds (it's saved as version 2); they upload their own copy over it and show a sync error telling you to reopen MK Max on your other devices so they update. The same bug gave the Kameo rarities a fusion step, so owning a Kameo no longer counted as done; loading the app now takes that step back off.

## Hosting

Every pull request runs `.github/workflows/ci.yml`: lint, tests and a build, the same checks a change needs before it's merged, shown on the PR. Pushing to `main` runs `.github/workflows/deploy.yml`, which lints, tests and builds the app, then publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`. In the repo settings, set **Pages → Source** to **GitHub Actions** first. On the free plan, Pages needs a public repo.

The deploy workflow also runs every day at 17:30 UTC to refresh the catalog and the event schedule. If either refresh fails, it warns and deploys the copy that's live again (`PAGES_URL` in the workflow), so check the run's warnings when the app's schedule date stops moving. GitHub turns off a public repo's scheduled workflows after 60 days without commits. The deploy workflow then stops running, even on a push, and the schedule stops updating. To turn it back on, open the repo's **Actions** tab, pick **Deploy to GitHub Pages** and choose **Enable workflow**.

On 2026-10-25 the app stopped updating itself (the service worker moved from `autoUpdate` to `prompt`, with a Reload bar). Builds from before that can't show the bar, and the new worker no longer takes over by itself, so a device on one of them stays on it until every copy of MK Max on it is fully closed and opened again. That deploy also moved saves to version 18, so such a device pauses sync until then.

## Styling

Styles are [Tailwind CSS](https://tailwindcss.com/) v4 utilities, built by `@tailwindcss/vite` (a dev dependency; nothing ships at runtime). `src/styles.css` defines the theme and removes Tailwind's default palette, so only the app's own colors exist (`bg-panel`, `text-muted`, `border-line`, `text-gold` and so on). It also holds the base look of buttons, inputs, selects and headings.

Repeated looks live in `src/classes.ts` as class sets, such as `card` for a page section or `row` for a list row. Never put two utilities that set the same property (two paddings, two background colors) on one element at the same breakpoint: which one wins depends on Tailwind's output order, not on the order in `className`. Add spacing and layout around a class set rather than overriding it.

## Layout

Below `md` (768px) the app is the phone layout: a header, the page in a column up to 720px wide, and the tab bar at the bottom. From `md` the header goes and the tabs become a left rail, 88px wide with the labels under the icons, and 220px wide from `lg` (1024px). The page can then grow to 1400px, and views add columns at `md`, `lg` and `xl` where there's room. The rail comes after the page in the DOM and is moved first with `order-first`, so the tab order is the same on every screen size. Pop-ups are 640px wide at most; the pack editor uses `Modal`'s `wide` option to grow to 920px from `lg`.

Keep phones unchanged when working on wider screens: put desktop styles behind `md:` and up, and check the phone layout at 390×844.

Only the content area scrolls; the header, the tab bar and the new-version bar (while one is ready) are fixed rows around it, not bars floating over a scrolling page. iPhone Safari can strand floating bars mid-screen when the scroll position jumps during a scroll (as on a tab switch), and this layout avoids that. Code that needs the scrolling area or a pop-up finds it by attribute, not by class: `scrollRoot.ts` looks for `[data-scroll-root]`, and pull to refresh and tab swiping ignore touches inside `[data-modal]`.

## Screenshots

`docs/screenshots/` holds the README images: the sample data (Settings → Load sample data) at 390×844, 2× scale, in dark mode. They're phone shots; there are no tablet or desktop ones. Retake them when a screen changes noticeably.

## Icons

The icon is a gold-ringed red medallion with a double up-chevron. `public/icon.svg` is the source. The PNGs next to it are rendered from it: `icon-192.png` and `icon-512.png` for the manifest, `icon-maskable-512.png` (the mark padded for Android's crop), and `apple-touch-icon.png` (180px). `public/logo-mark.svg` is the medallion without its background tile, used in the header and the side rail. If you change the design, re-render all four PNGs. Phones cache home-screen icons, so remove the app and add it again to see a new one.

The tab icons, and the ones on the Cards, Tower gear and Maxed buttons, are inline SVGs in `src/icons.tsx`. They use the current text color, so the active tab's icon turns red.
