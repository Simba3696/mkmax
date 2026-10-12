# TODOS

## Realm Klash gear

### Let a gear order tap keep its own direction, and skip taps that move nothing

**What:** Pass the arrow's direction (up or down) into `moveInGearOrder` instead of working it out from where the two pieces sit now, and don't call `update` when the order comes back unchanged.

**Why:** A tap made on a screen that's one move behind (a sync landing between render and tap) moves the piece back and undoes the last move. A tap whose pieces have gone (maxed, or removed by a sync) still stamps the save and pushes a sync for nothing, which can make this device's copy look newest.

**Context:** Found by the /ship review of todo-followups (2026-10-12). `move` in `src/views/GearOrder.tsx` and `moveInGearOrder` in `src/engine.ts` (`from < to` picks the side). Both cases are rare; React flushes ordinary double taps first.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Plan

### Work the plan out once when the phone wakes the app

**What:** In `useNow` (`src/ui.tsx`), restart the minute timer on return, or have its tick skip when the reading is under a minute old.

**Why:** On a phone that paused timers while asleep, waking the app reads the time on the visibility event and then again when the overdue minute tick fires, so the whole planner runs twice within milliseconds. The plan is right; it only costs time on wake.

**Context:** Found by the /ship review of todo-followups (2026-10-12). Extend `src/ui.test.tsx`; it fakes only `Date`, so this needs fake timers too.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Name the one-minute tick in useNow

**What:** Add a `TICK_MS = 60000` next to `AWAY_MS` in `src/ui.tsx` and use it for both the `setInterval` and the quick-return check.

**Why:** The quick-return rule ("read the time if a minute tick was missed") only works while its `60000` matches the interval's. Two bare numbers can drift apart.

**Context:** Found by the /ship maintainability review of todo-followups (2026-10-12).

**Effort:** S
**Priority:** P4
**Depends on:** None

### Read the time on a back-forward restore that only fires pageshow

**What:** In `useNow`, also read the time on `pageshow` when `event.persisted` is true, under the same rules as a return.

**Why:** Some WebKit versions restore a page from the back-forward cache with only `pageshow`, no `visibilitychange`, so the time waits for the next minute tick (up to about a minute). Rare in an installed PWA.

**Context:** Found by the /ship adversarial review of todo-followups (2026-10-12).

**Effort:** S
**Priority:** P4
**Depends on:** None

## Completed
