# TODOS

## Saved data

### Keep a newer save safe from an older copy of the app on the same device

**What:** When the app loads a local save from a newer version (`fromNewerApp`), keep it as it is instead of reading it and saving over it, and say the app needs updating.

**Why:** Sync and Import already refuse a newer save, but local load doesn't. An older copy of the app (a deploy rolled back past a version bump, or an old tab left open) reads the save, drops the fields it doesn't know, such as the Maxed record from version 17, and saves the result straight back. The next sync can then push that copy over the synced one. The Maxed record has no other copy, so it would be lost.

**Context:** `load()` in `src/storage.ts` runs `normalize(JSON.parse(raw))` on whatever is in localStorage, and `StoreProvider` saves the result on its first render. `keepUnreadable` already keeps a save the app can't read; a newer save could be kept the same way, with the "made by a newer version" message sync shows. This only protects later version bumps (17 to 18 and on), since copies already in use don't have the check. Found by the data-migration review in /ship run 4 on maxed-record (2026-10-19).

**Effort:** S
**Priority:** P2
**Depends on:** None

## Completed
