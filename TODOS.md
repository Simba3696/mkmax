# TODOS

## Realm Klash gear

### Keep an off-sale piece's place in the Blood Ruby gear order

**What:** When ↑/↓ in Settings → Blood Ruby gear order saves the order, keep each piece that isn't on sale at its saved place and only swap the two pieces being moved.

**Why:** Today the save writes the pieces on sale first and the others after them, so a piece you put first drops below every piece on sale once its store item is back. The new "Not on sale now" line lists such pieces under the order with no way to move them, so the lost place is easy to miss.

**Context:** Found by the /ship red team on tidy-todos (2026-10-12); it predates that branch. `move` in `src/views/GearOrder.tsx` builds `ids` from `gear` (`gearQueue`, pieces on sale only) and appends the rest of `gearOrder`. Fix: rank queued and waiting pieces together (by saved index, then `DEFAULT_GEAR_ORDER`) and swap inside that list, with an engine test.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Test that Rerun keeps a Realm Klash store item a store item

**What:** Add a row to the Rerun test in `src/events.test.ts`: an earlier run with `store: true`, a Blood Ruby currency and a drop, under a name that isn't a Kasket, reruns with `store: true`, the same drop and no `kasket`.

**Why:** The note on kept items promises "Rerun copies its drop and Store item setting". If a change to the Kasket logic in `packFromShop` left `copy` empty for a store item, Rerun would add a plain pack, the piece would leave the gear queue, and every test would still pass.

**Context:** Found by the /ship testing specialist on tidy-todos (2026-10-12). `copy` is `last && !kasket ? last : undefined` in `packFromShop` (`src/events.ts`); `grep store src/events.test.ts` finds nothing.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Plan

### Say "every buy" for a store item that always drops its card

**What:** In Pack ranking, a card a pack always drops reads "100% per buy · every buy" (or similar) instead of "about 1 buys per copy".

**Why:** "about 1 buys per copy" is wrong English and says nothing a 100% drop doesn't already say.

**Context:** Found by /qa on tidy-todos (2026-10-12). Repro: add a store item with one drop at 100%, open the Plan, look under Pack ranking. The line comes from `targetLine` in `src/ui.tsx`, which has tests in `src/engine.test.ts` ("pack ranking lines").

**Effort:** S
**Priority:** P3
**Depends on:** None

### Time the return-to-app clock check from when the app was hidden

**What:** In `useNow` (`src/ui.tsx`), note the time when the page goes hidden and, when it's shown again, read the time again only if it was hidden for 30 seconds or more.

**Why:** The check compares against the last time read, not how long the app was away. A quick switch just before the minute tick still works the whole plan out again, and after timers were paused the time can lag by up to about 90 seconds. The pack editor's season and end-date choices use this shared time too.

**Context:** Found by the /ship adversarial review on tidy-todos (2026-10-12). Extend `src/ui.test.tsx`, which covers hidden, a quick return and a long return.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Say in the comments and architecture doc that the clock also moves on return

**What:** Update the comments that say the shared clock moves only once a minute: the header and `now` field in `src/planner.tsx`, the `useNow` comment in `src/ui.tsx`, and the two lines in `docs/architecture.md` ("once per change and once a minute").

**Why:** The clock now also reads the time again when the app comes back after a while in the background, which is why it changed.

**Context:** Found by the /ship maintainability specialist on tidy-todos (2026-10-12).

**Effort:** S
**Priority:** P4
**Depends on:** None

## Import

### Keep a Kasket when an import marks a pack with no drops a store item too

**What:** In `kasketShape` (`src/engine.ts`), let the store item win only when the pack has drops; a pack with no drops keeps its Kasket.

**Why:** A hand-edited import with `store: true`, a `kasket` and empty `drops` now becomes a store item that drops nothing, so the planner values it at 0 without a word. The app never saves both itself, so only an edited import reaches this.

**Context:** Found by the /ship adversarial review on tidy-todos (2026-10-12). `kasketShape` runs on every load from `normalize`. Add a row to the import test in `src/engine.test.ts` ("save migration").

**Effort:** S
**Priority:** P4
**Depends on:** None

## Completed
