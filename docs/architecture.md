# Architecture

How MK Max is put together and why. For the scoring maths, see [How it works](how-it-works.md). For setup and the file-by-file layout, see [Development](development.md).

## System context

MK Max is a static, client-only PWA. There's no backend: everything the app knows lives in the browser, and the only network calls at runtime are to GitHub (optional sync) and the MK Mobile wiki (an image fallback).

```mermaid
flowchart LR
  subgraph CI["GitHub Actions (on push + daily 17:30 UTC)"]
    F1["scripts/fetch-catalog.mjs"] --> C["public/catalog.json"]
    F2["scripts/fetch-events.mjs"] --> E["public/events.json"]
  end
  MKB["MK Mobile Base API<br/>(no CORS)"] --> F1 & F2
  CI -->|"vite build"| GP["GitHub Pages<br/>(static PWA)"]
  GP --> App["MK Max in the browser"]
  App <-->|"localStorage"| LS[("Saved state")]
  App <-->|"optional, user's token"| Gist[("Secret GitHub Gist")]
  App -->|"image fallback"| Wiki["MK Mobile wiki API"]
  App -.->|"hotlinked art,<br/>cached by the service worker"| MKB
```

Two constraints shape this:

- **MK Mobile Base doesn't allow cross-origin requests**, so the browser can't call it. CI fetches the catalog and the event schedule at build time and ships them as static JSON. When the site is down or its data looks wrong, the deploy ships the copies that are live again, or the committed ones if those can't be downloaded. The schedule script also reads the live `events.json` to keep Realm Klash weeks the site has dropped.
- **No server to run or pay for.** Personal data stays on the device; sync goes through a gist the user owns, using their own token.

## Layers

```mermaid
flowchart TB
  Views["views/*.tsx, App.tsx<br/>(React: tabs, editors, panels)"]
  Store["store.tsx, planner.tsx, storage.ts, syncLoop.ts<br/>(state, undo, shared plan, persistence, sync loop)"]
  Engine["engine.ts<br/>(pure: scoring, planner, kard plan, forecasts, purchases, pack saving)"]
  Data["normalize.ts, defaults.ts, challenges.ts, kaskets.ts, types.ts<br/>(save shape, migrations and built-in game data)"]
  Ext["events.ts, catalog.ts, wiki.ts, sync.ts<br/>(external data)"]
  Views --> Store
  Views --> Engine
  Views --> Ext
  Store --> Data
  Store --> Engine
  Store --> Ext
  Data --> Engine
  Engine -.-> Data
  Engine -.-> Ext
```

- **`engine.ts` is plain TypeScript with no React and no I/O.** It takes an `AppState` and a `now` and returns plans. Its imports beyond types (the dotted edges) are `kaskets.ts`, for the Kasket exclusion list, and `nameKey` from `catalog.ts`, which both use to match names (the Realm Klash gear list is matched the same way); nothing it calls fetches. That's what makes the planner unit-testable (`engine.test.ts` is the biggest test file) and lets scripts reuse it. Keep it that way: anything that needs the clock, the network or the DOM belongs in a view, the store or an `Ext` module, and gets passed in. It also holds the rules views apply when they change data, like logging a purchase (`recordPurchase`), saving a pack from the editor (`editedPack`, `packEndOnSave`, `editorSeasonEnd`, `seasonMoveOnSave`, `savePack`, `addPool`), removing a rarity with its Kaskets (`removeRarity`), moving a rarity past the neighbour the screen showed (`moveRarity`, so a tap after a sync moved either of the two moves nothing rather than the wrong rarity), saving the Blood Ruby gear order after ↑/↓ (`moveInGearOrder`), which expired packs Clear expired keeps (`keepWhenExpired`), which tower a typed name is and how the Tower list spells it (`towerKey`, `towerSpellings`, shared by Cards, Tower gear and Paste a list, which leave out cards under a rarity a sync removed), and fixing a tower's spelling on every card naming it (`respellTower`), so those are tested too. The editor works on a copy of the pack, so `editedPack` lays its changes over the pack as it is when saved: Already bought and the end date keep a purchase or season move that landed meanwhile.
- **`store.tsx` owns the single `AppState`.** Every change goes through `update(recipe, undoLabel?)` (the label can be a function, called after the recipe, when it counts what changed; a recipe that finds nothing to change returns `noChange`, and nothing is saved, so a tap on a screen a sync has made out of date can't stamp this device's copy as newest), which clones the state, applies the recipe, removes finished cards (`pruneDone`, which first stores a goal of max on Realm Klash gear so older copies of the app keep it), stamps `updatedAt` (with `SyncLoop.nextStamp`, so the stamp is always after this device's last one and the last agreed one, whatever the clock says), saves to localStorage and schedules a sync push. Changes the app makes by itself that every device derives the same way (catalog art) pass `{ auto: true }`, which saves them without stamping or pushing, so they can't cause sync conflicts. A change whose first steps were saved without Undo can pass `{ undoFrom }` to adjust the state its Undo goes back to: a Tower box saves as it's typed, so when its finish re-spells the tower on other cards, Undo puts the typed card back too. `undo` and `dismissUndo` take the entry the Undo bar showed when it was pressed and do nothing once a newer one has replaced it (pressing the bar can finish a Tower box, which puts a new entry there before the click lands). The bar's time only runs while the page is visible. The season-end move from the schedule is a normal change, since which packs it moves depends on when it runs, except on a fresh install (no stamp, no packs): stamping that would make a new device's first sync a conflict instead of a pull. It waits for `sync.settled` (this launch's first sync attempt has finished, whatever the outcome) so it usually runs on the other devices' latest data.
- **The plan is derived, never stored.** `PlanProvider` in `planner.tsx` works out `buildCtx(state)` and `buildPlan(ctx, now)` once per change and whenever the clock moves on (once a minute, and when the app comes back after half a minute or more in the background or is restored from the back-forward cache), and every view reads them through `usePlan()`, so the Packs badge and the Plan tab share one run of the planner. Nothing derived is saved, so there's no cache to invalidate beyond React's own memos.

## State model

One JSON document, `AppState` in `types.ts`: rarities (fusion and kard tables), currencies, cards, packs, weights, and a few lists (gear order, dismissed shop packs, the Maxed record). It's saved whole to localStorage under `mkmax:v1` and synced whole to the gist. If that save can't be read at startup, `load()` in `storage.ts` copies it to `mkmax:v1:unreadable` before the fresh state is saved over it, and resets the sync `baseUpdatedAt` to 0 so the first sync pulls the gist's copy rather than counting the empty state as agreed. Settings → Data offers the copy as a download until the user discards it. A save from a newer version than this build's (`fromNewerApp`) is read for display but held: `save()` writes nothing, `update`, `replace` and Undo in `store.tsx` refuse changes, and sync never pulls or pushes, until a reload brings the newer build. The hold starts at `load()` (a deploy rolled back past a version bump) or, through a `storage` event, when another tab on the newer build saves while this one is open (`holdIfNewer`, which throws on text that isn't JSON rather than reading past it); that tab keeps showing the data it had. Otherwise this build would save the data back without the fields it doesn't know, and the next sync could push that over the synced copy. Export backup writes the save as stored (`savedText`), not this build's reading of it, so a backup taken meanwhile keeps the newer fields. A held save whose upgrades fail in `normalize()` stays under `mkmax:v1` rather than being moved aside as unreadable; one that isn't valid JSON has no version to read, so it still goes the unreadable way.

Decisions worth knowing:

- **Finished cards leave the card list.** Reaching a goal removes the card, its drop entries and any store item that only sold it. Undo is the safety net. The card list is a to-do list for maxing; a card that leaves at its top level goes on the Maxed record instead (`AppState.maxed`: name, rarity and day, added in `pruneDone`), which the planner never reads. Completion there comes from `completion` in `catalog.ts`, against MK Mobile Base's catalog. A card on the record isn't added again (`onMaxedRecord`, which checks a key set cached per record array, `maxedKeys`; the record is never changed in place, so the cache stays right). Two things take a card off the record: a Paste a list line with a Stage (`unmarkMaxed`), or ✕ on the Maxed page. A Settings rule change prunes cards without recording them (`update`'s `ruleChange`, `pruneDone`'s `record`). A new card pasted at its top level (`atTopLevel`) goes on with no day (`recordMaxed`). Removing a rarity removes its entries too (`removeRarity`).
- **A Kasket stores its rarity, not its drops.** `Pack.kasket` names the rarity, and `packDrops` works out its drops from the cards each time (`kasketPool`: the cards you don't own, minus the newest from the latest update in `kaskets.ts`, then cards short of max for a rarity tracked to max). Everything that reads drops (`packEV`, `rankPacks`, `buildPlan`, `rankTargets`, the pack list) goes through `packDrops`, so unlocking a card updates the odds with nothing stored to go stale. Each rarity's eligible cards are kept per `Ctx` (a `WeakMap`), since the planner asks for every Kasket on every pass. `kasketShape` keeps a Kasket at one card per purchase with no drops or store item; `savePack` and every load (`normalize`) apply it, so an import or synced save can't give a Kasket odds the screen hides, and a `null` or empty rarity means it isn't a Kasket.
- **Levels are stored as copy counts**: 0 = not owned, 1 = F0, 11 = F10, then ascension. `levelLabel` turns them into F/A labels. Version 1 stored F1 as the first copy, which is why `migrateV1` exists.
- **Every load goes through `normalize()`**: localStorage, imports and sync pulls. It runs each migration once, by `version`, so a later user edit (deleting a rarity, removing a tag) sticks. See [Development → Saved data and migrations](development.md#saved-data-and-migrations).
- **Per-device settings aren't in `AppState`.** Sort orders, folded cards and the sync token live in their own localStorage keys (`mkmax:cardSort`, `mkmax:packSort`, `mkmax:folded`, `mkmax:sync`), so they never sync or get exported.

## Planner (LLD)

`buildPlan` in `engine.ts`, run once per change (and whenever the clock moves on) by `PlanProvider`:

1. **Kard allocation** (`allocateKards`, inside `buildCtx`). For character rarities, spend its Fusion Up Kards one step at a time on the step with the best `cardWeight / kardCost`, tie-breaking on the card with the fewest steps left to its goal. For gear rarities, finish whole pieces instead, cheapest total first (ties: higher level, then name), stopping at the first piece the kards can't finish and recording it as `next`. Pieces with a step that has no kard cost can never be finished and are listed as `stuck`. Realm Klash gear and cards marked No kards (`Card.noKards`) are excluded, and so is any rarity not tracked to max, since only those have a kard box. The result is how many copies kards will supply per card, which the next step treats as worth less.
2. **Copy value** (`copyValue`). The `g`-th extra copy of a card falls into a phase (unlock, to F3, packs only for a No kards card, normal, covered by kards, maxed) with its own multiplier, times the card's weight (guest, Kameo, challenge), times a closeness bonus. `gainValue` integrates this over fractional expected copies.
3. **Blood Ruby gear first.** For Blood Rubies only, walk `gearQueue` in order and buy each piece's cheapest store item until the piece is maxed. If the next copy isn't affordable, stop and save for it; nothing else is bought with rubies.
4. **Greedy per currency.** Repeatedly buy the affordable pack with the best `packEV / cost` (times `limitedBoost` if it has an end date), adding its expected copies to a shared `gained` map so later buys, in any currency, see diminishing returns. A Kasket's pool is worked out from `gained` before each buy, so once every new card is expected, later Kaskets are valued from the cards short of max. Stop when nothing affordable has positive value. The best pack you can't afford becomes `saveFor`.
5. **Forecasts** (`daysToAfford`, `gearForecast`) divide shortfalls by the currency's `perDay`.

Greedy-by-ratio isn't optimal for a knapsack in general, but purchases are small next to balances, values are estimates anyway, and the result is explainable to the user line by line. That trade is deliberate.

## Sync

```mermaid
stateDiagram-v2
  [*] --> Decide: app opens / comes to front / every 2 min / 1.5 s after a change
  Decide --> Push: only local changed (or no gist file)
  Decide --> Pull: only remote changed
  Decide --> Conflict: both changed since base, to different data
  Decide --> Outdated: remote saved by a build from before 2026-09-28
  Decide --> Newer: remote saved in a newer version than this build's
  Decide --> Idle: neither changed, or both made the same change
  Conflict --> Push: user keeps mine
  Conflict --> Pull: user keeps theirs
  Outdated --> Push: overwrite and show an error
  Newer --> Idle: change nothing and show an error
  Decide --> Unreadable: this build's normalize() throws on the remote
  Unreadable --> Idle: change nothing and show an error
  Push --> Idle
  Pull --> Idle: normalize() then replace
```

The loop itself is `SyncLoop` in `syncLoop.ts`, plain TypeScript with GitHub, the state and timers passed in; `store.tsx` wires it to React. `decideSync` in `sync.ts` compares each side's `updatedAt` with `baseUpdatedAt`, the stamp both last agreed on. When both sides moved but hold the same data apart from the stamp (each device moved the season end by itself), `sameData` makes it a no-op and both stamps count as agreed. While a conflict waits for the user, background syncs hold off, and a sync that ends in a conflict or an error doesn't reschedule itself; the regular pulls retry. Keeping this device's copy first re-reads the gist: if the other device pushed again while the prompt was up, the prompt shows that copy instead. Otherwise it restamps the kept copy above both copies (the outdated branch does the same), so the other device pulls it, or asks if it has changed since, rather than overwriting it with its own next edit. Data saved in a newer version than this build's is neither pulled nor pushed (an app left open across a deploy would otherwise save it back in its older format and drop fields, and the newer build would then rerun one-time migrations over the user's later changes); the loop shows an error and leaves the update to pull to refresh or a reopen, since finding it reloads the page: the reload waits for pop-ups and the Undo bar, but not for what's half typed on the page itself, like the Add card form or a rename, and a background sync can come at any moment. Import backup refuses such a file too. The same goes for a gist copy this build's `normalize()` throws on (`canRead`): pulling it would fail, and pushing or asking would let a device whose own save couldn't be read upload its fresh data over it, so the loop shows an error and waits for an update. If applying the gist's copy fails after Keep theirs anyway, it shows that error rather than leaving a prompt whose buttons do nothing. Edits are stamped with `nextStamp`, after both this device's own stamp and `baseUpdatedAt`: after a pull, the agreed stamp comes from the other device's clock, and a device whose clock runs behind would otherwise stamp its edits as older than it and never push them. A sync that finishes after the user disconnected changes nothing. It's last-writer-wins with conflict detection, not a merge: the data is small and edited by one person, so asking which copy to keep is simpler and safer than merging fields.

## Offline and updates

`vite-plugin-pwa` precaches the app shell. `main.tsx` asks for persistent storage (`navigator.storage.persist()`) at startup, since without sync localStorage is the only copy of the data and browsers may clear it. `events.json` is network-first (it changes daily), falling back to the cached copy after 4 seconds on a connection that hangs, and card art from MK Mobile Base and the wiki is cache-first for 90 days. The build stamps the short commit id and commit date into `__APP_VERSION__`, shown at the bottom of Settings. It's the commit date, not the build date, so the daily scheduled deploy, which rebuilds the same commit with new `events.json` and `catalog.json` (neither precached), builds identical app files: the service worker doesn't change and no device downloads the app again or reloads. Pull to refresh checks for a new service worker and reloads into it. A new worker activates as soon as it's found, but `appUpdate.ts` holds the reload while a `[data-modal]` pop-up or the `[data-undo]` Undo bar is up and reloads once both are gone, so an update found just after launch can't throw away a half-entered pack or the Undo for saving it. While the app is hidden only a pop-up holds it: the Undo bar's time doesn't count then, so waiting for the bar would reload just after the user comes back, over whatever they start typing (`appUpdate.test.ts`).

## Styling and layout

Styles are Tailwind CSS v4 utilities, built at compile time by `@tailwindcss/vite`, so there's no runtime styling dependency. `src/styles.css` holds the theme tokens (`@theme`, with Tailwind's default palette removed so only the app's colors exist) and the base control styles. Shared class sets are in `src/classes.ts`. Each set owns its properties, so nothing should add a second utility for the same property on the same element at the same breakpoint.

`App.tsx` has one layout that changes at `md` (768px). Below it, a header, a 720px page column and a bottom tab bar, which is the phone design and must stay as it is. From `md`, a left rail (88px, 220px from `lg`) replaces the header and tab bar, the page grows to 1400px, and views add columns. The rail is moved with `order-first` rather than in the DOM, so keyboard and screen reader order don't change. Only `<main data-scroll-root>` scrolls; pop-ups are portalled to `<body>` with `data-modal`, and `Modal` makes `#root` inert while one is open and gives focus back to the opener when it closes. `scrollRoot.ts`, `PullToRefresh` and `useSwipeTabs` find these by attribute, so restyling can't break them.

## Testing

Vitest covers the pure modules: the engine, migrations via `normalize`, sync decisions, the sync loop (two devices against a fake gist, with requests held open to edit or disconnect mid-sync), the list parser, catalog and event name matching, the schedule script's parsing and season carry-over (`scripts/schedule.test.mjs`), and when an app update's reload waits (`appUpdate.test.ts`). A few screen tests render the real store and plan in jsdom with Testing Library: the logo and the Cards tab's switch to Tower gear, the shared plan and clock, undo labels, the Undo bar (its time, counted only while the app shows, and which change Undo and ✕ act on), buying and fusing from Packs, Cards and the Plan, taps that save nothing once a sync has made the screen out of date (and Settings rows edited by id), moving a rarity in Settings (where the page scrolls and keyboard focus goes after a move), Clear expired, Realm Klash gear not on sale, a save from a newer version (the notice on every tab, the pack editor's Save, and Settings' backups and sync), the Tower gear kard threshold filter (which gear and towers it lists, and a piece tapped up to the threshold staying listed until the filter changes), the Cards Tower list (picking, adding and clearing a tower, its Undo, a sync or a page switch while a new name is typed, and one tower spelled two ways), the name order of the card lists on Packs and in the pack editor, and the Maxed page (its record, completion and Paste maxed cards) (see [Development → Tests](development.md#tests)). The event schedule's downloads (again on return, and when two overlap) are tested in jsdom too, in `events.restore.test.ts` and `events.firstload.test.ts`. The rest of the views are thin over the engine and are checked by running the app. CI runs lint and tests before every deploy.
