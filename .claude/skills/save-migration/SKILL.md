---
name: save-migration
description: Bump the MK Max save version and add a one-time migration. Use when a change alters the shape or meaning of AppState (new or renamed fields, new rarities, changed level encoding, data fixes for existing saves).
---

# Save migration

Saved data reaches the app from localStorage, backups, the gist and the starter data, and all of it goes through `normalize()` in `src/normalize.ts`. A migration runs once, gated on the version it was saved with, so anything the user changes afterwards sticks.

## Do you need one?

- New optional field with a safe default: no version bump. Default it in the `out` object in `normalize()` (like `gearOrder: s.gearOrder ?? []`).
- Anything that changes existing data (renames, new built-in rarities, changed meaning of a number, fixing bad data): yes.

## Steps

1. In `src/types.ts`, bump the `version` literal on `AppState` and add a short line to its doc comment saying what the new version did.
2. In `src/defaults.ts`, bump the version in `defaultState()`.
3. In `src/normalize.ts`:
   - Set `version` in the `out` object to the new number.
   - Add a step gated on `if (version < N)` with a comment in the same style as its neighbours: what it changes and why it only runs once.
   - Put it before the `out` object if it reshapes raw input, after it if it edits normalized cards, packs or currencies.
4. Add a test in the matching `*.test.ts` that loads an old-version save through `normalize()` and checks the result, plus one showing that a save already at the new version isn't changed again.
5. `src/sync.ts` treats `version <= 2` as an outdated app. Leave that alone.
6. If users will notice the change, describe it in `docs/user-guide.md` or `docs/how-it-works.md`. Note the migration in `docs/development.md` only if it has a story worth keeping (like the 2026-09-28 one).
7. Run `npm run lint`, `npm test` and `npm run build`.

## Pitfalls

- Don't re-add something on every load (a rarity, a tag). Gate it on the version, or deleting it won't stick.
- `normalize()` also runs on data pulled from another device running an older build. Keep migrations idempotent with respect to the version check.
- `pruneDone(out)` runs at the end, so a migration that raises levels can delete cards. That's intended; check the tests cover it.
