# TODOS

## Completed

### Keep a newer save safe from an older copy of the app on the same device

**What:** When the app loads a local save from a newer version (`fromNewerApp`), keep it as it is instead of reading it and saving over it, and say the app needs updating.

**Why:** Sync and Import already refuse a newer save, but local load doesn't. An older copy of the app (a deploy rolled back past a version bump, or an old tab left open) reads the save, drops the fields it doesn't know, such as the Maxed record from version 17, and saves the result straight back. The next sync can then push that copy over the synced one. The Maxed record has no other copy, so it would be lost.

**Context:** Found by the data-migration review in /ship run 4 on maxed-record (2026-10-19). `load()` in `src/storage.ts` now holds such a save, and so does a tab already open when another tab saves one: it's shown, but `save()` writes nothing, the store refuses changes, sync is paused, and every tab shows a notice to update. This only protects later version bumps (17 to 18 and on), since copies already in use don't have the check.

**Effort:** S
**Priority:** P2
**Completed:** maxed-record (2026-10-19)
