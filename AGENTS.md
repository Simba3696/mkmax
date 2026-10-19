# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor and others) working in this repo. Humans should start with the [README](README.md) and [Development](docs/development.md).

MK Max is a client-only React 19 + TypeScript PWA that plans Mortal Kombat Mobile pack purchases. Read [docs/architecture.md](docs/architecture.md) before changing anything structural, and [docs/how-it-works.md](docs/how-it-works.md) before touching scoring.

## Commands

```sh
npm run dev     # http://localhost:5173
npm test        # Vitest
npm run lint    # oxlint
npm run build   # tsc --noEmit, then vite build
```

A change is done when `npm run lint`, `npm test` and `npm run build` all pass. CI runs lint and tests before every deploy, and pushing to `main` deploys.

## Rules

- **Keep `src/engine.ts` pure.** No React, no `fetch`, no `Date.now()`, no `localStorage`. Pass `now` in. New planning logic goes here with tests in `engine.test.ts`.
- **All state changes go through `update(recipe, undoLabel?)`** in `store.tsx`. Give user actions that change or remove data an undo label. A recipe that finds nothing to change (the card, pack or row a tap was for is gone, or already that way) returns `noChange`, and finds rows by id, never by their place on screen.
- **Changing the saved shape or meaning means a migration.** Use the `save-migration` skill (`.claude/skills/save-migration/`). Never pull synced data with `version <= 2`.
- **Update the docs in the same change.** Behaviour goes in `docs/user-guide.md`, scoring and data sources in `docs/how-it-works.md`, structure in `docs/architecture.md`, setup and conventions in `docs/development.md`. Touch the README's Features list only for headline features.
- **Write like the existing docs and commits.** Plain sentences about what the user sees, no jargon. Commit subjects and PR titles (main squash-merges each PR) start with a Conventional Commits type, `feat`, `fix`, `refactor`, `test`, `docs` or `chore`, then a plain lowercase sentence: "feat: show how many cards each rarity and source filter option would list". Comments explain why, not what.
- **Style with the theme and shared class sets.** Use the colors and sizes from `src/styles.css` and the sets in `src/classes.ts`. Never put two utilities that set the same property on one element at the same breakpoint. Keep phones (below 768px) looking the same; desktop styles go behind `md:` and up. See [Development → Styling](docs/development.md#styling).
- **MK Mobile patch notes go through the `patch-notes` skill** (`.claude/skills/patch-notes/`): it sorts each change into code, automatic, the user's own data, or not modelled, and agrees a plan before editing.
- **Don't add dependencies** without a strong reason. The app has two runtime dependencies and should stay small. Tailwind (`tailwindcss`, `@tailwindcss/vite`) is a dev dependency: it runs at build time and adds nothing to the shipped app. So are Testing Library and jsdom, which only the screen tests use.

## Game rules the code depends on

These aren't obvious from general game knowledge. Don't change them unless asked.

- The first copy is F0; each level takes one duplicate (F10 = 11 copies). Diamonds max at F10; Gold cards go on to a per-card ascension cap (F10, A5 or A10). The game calls A5 Stage I Ascension and A10 Stage II Ascension; updates move batches of characters to Stage I or Stage II.
- Each ascension step also takes one duplicate (or Fusion Up Kards in its place), plus Ascension Kards (1, 1, 2, … per step). Ascension Kards are a scarce premium item from season passes and aren't tracked or planned; the user ascends whenever they get one.
- Fusion Up Kards work only from F3 up, cost more per step (Diamond: 1, 2, 3, 4, 5, 7, 10), and each rarity has its own kards.
- Rare and Epic gear is tracked to F3 by default; kards finish it. A card entered (Add card, Paste a list, the pack editor) already at or past F3 while tracked to F3 is saved with Goal Max instead (`entryGoal`); one levelled up to F3 later is done there. Gear only gets its special effect at F10, so when a gear rarity's Track until is Max, its kards finish one piece at a time (fewest kards needed first) and leftovers wait for the next piece; characters keep spreading kards over the cheapest steps. Realm Klash gear is a fixed set of 10 Epic pieces (`REALM_KLASH_GEAR` in `src/engine.ts`, matched by name; no more are coming), always tracked to max and bought with Blood Rubies, one piece at a time in the user's order, before anything else Blood Rubies buy. Never plan kards on it, and Kaskets never give it.
- Some cards can't take Fusion Up Kards at all (summon exclusives like MK1 Noob Saibot). The user marks them **No kards** (`Card.noKards`): no kards are planned or offered, the card is always worked toward max, and every copy after the first is valued at the threshold weight, since packs are the only way to get it.
- Kaskets give one random card of their rarity you don't own, minus the newest cards from the latest update; once you own them all, one you haven't maxed (below its own cap, so ascending Gold counts). Guests and tower or Krypt gear are in the pool.
- Kameos only need owning. Elder challenge Kameos are weighted down because the challenge guarantees one.
- Every card is wanted. Don't add priority tiers ("Must-have", "Skip"); the only reasons a copy is worth more are game mechanics.
- Cards that reach their goal leave the card list. One that leaves at its top level (F10, a Gold card's own cap, or owned for a Kameo) goes on the Maxed record for completion; gear done at F3 isn't maxed, so it doesn't.
- Don't model duplicate refunds, tower or Krypt drops as pack sources, Koins, or guest-event dates. Urgency comes from the pack end dates the user enters or the event schedule provides.
- MK Mobile Base has no CORS. Fetch from it only in `scripts/`, never from the app (hotlinked images are fine).
