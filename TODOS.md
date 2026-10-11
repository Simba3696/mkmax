# TODOS

## Kaskets

### Only turn a pack into a Kasket when its rarity exists

**What:** In the version 15 upgrade (`src/normalize.ts`) and in `packFromShop` (`src/events.ts`), convert a shop-named pack only when the rarity it maps to is still in the save and isn't a Kameo rarity.

**Why:** A save whose built-in Epic, Rare, Diamond or Gold rarity was deleted (or rebuilt under a new id) would have that pack's typed odds wiped and get a Kasket that says "This Kasket's rarity no longer exists". The upgrade runs once, so the odds can't come back.

**Context:** Found by the /ship review on 2026-10-10 (maintainability and red team). Fix: `kasket && out.rarities.some((r) => r.id === kasket && r.kind !== 'kameo')`, with a migration test that removes `epic` first. The user's own save keeps the built-in rarities, so this is a guard for other saves.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Test the "yours within n buys" edges

**What:** Add rows to the `withinBuys` test in `src/engine.test.ts`: buys left equal to the pool size (still shown), no buys left (not shown) and a pool of one (`withinBuys` 1).

**Why:** Changing `<=` to `<` in the purchase-limit check, or a slip in the one-card wording, would pass every current test.

**Context:** Found by the /ship testing specialist on 2026-10-10. The wording lives inline in `src/views/PlanView.tsx`; moving it into a small helper next to `kasketLine` in `src/ui.tsx` would let it be tested the same way.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Say a Kasket's last card once in the Pack ranking

**What:** For a Kasket with one card left, the Pack ranking reads "Name: 100% per buy · yours next buy". Show one phrase.

**Why:** Both halves say the same thing.

**Context:** `src/views/PlanView.tsx` target line, and `docs/user-guide.md` (Pack ranking). Found by the /ship design specialist on 2026-10-10.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Fix the Rerun tooltip for Kaskets

**What:** The Rerun button says "Adds it again with the odds from its expired run", but a Kasket rerun copies only the name.

**Why:** The tooltip promises something a Kasket rerun doesn't do.

**Context:** `src/views/PacksView.tsx` (In the shop row). Use a Kasket-specific title when `kasketFor(packName(sp))` matches. Found by the /ship red team on 2026-10-10.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep an unticked Kasket unticked on Rerun

**What:** When a shop Kasket's earlier run was unticked as a Kasket, Rerun ticks it again and doesn't copy that run's odds. Use the earlier run's setting when there is one.

**Why:** The version 15 comment says a pack the user unticks stays unticked; Rerun undoes that.

**Context:** `packFromShop` in `src/events.ts` takes `kasket` from the shop name alone. Issue #1 asked for Kaskets from In the shop to ignore an earlier run, so the events test "even over an earlier run with drops of its own" needs updating with the change. Found by the /ship adversarial review on 2026-10-10.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep a store item when an import also marks it a Kasket

**What:** In `kasketShape` (`src/engine.ts`), when a pack has both `store` and a `kasket`, drop `kasket` rather than `store`.

**Why:** A hand-edited or corrupted import with both set loses its store item, which for Realm Klash gear drops it from the gear queue without a word.

**Context:** Found by the /ship adversarial review on 2026-10-10. Needs an import the app itself never writes.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Match the newest-cards list by rarity as well as name

**What:** Key `KASKET_EXCLUDED` in `src/kaskets.ts` by name and rarity.

**Why:** A same-named card of another rarity would be left out of its Kasket too. Today the only clashes are Diamond Kameos, which Kaskets never give.

**Context:** Found by the /ship adversarial review on 2026-10-10. Revisit when a patch adds a character and gear of the same name.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Gear kards

### Tidy up how Realm Klash store items are kept

**What:** Fix the loose ends of "Clear expired keeps Realm Klash gear store items" (`keepWhenExpired` in `src/engine.ts`, Clear expired in `src/views/PacksView.tsx`):
- First: the Packs paragraph in `docs/user-guide.md` says to delete a kept item by hand "once you no longer need it". You need it as long as the piece exists, and `pruneDone` deletes it when the piece is maxed, so reword it to "leave it", and warn on the per-pack Delete for a kept item.
- The undo label says "Cleared 1 expired packs".
- The guide doesn't say Clear expired hides when only kept items are left.
- Nothing in the app says why those items stay.
- `keepWhenExpired` keeps every expired copy and items that mark nothing (a piece with a stored Max, Uncommon gear, gear still tracked to F3). Keep only the last item marking a piece.
- Its tests don't check the store and Blood Ruby conditions separately.
- A piece whose only store item expired is in no plan at all (no kards, no ruby buys). Say so on the Plan.
- Picking plain Max in the Goal list does nothing while an expired store item still marks the piece.
- The undo count comes from the render, not the draft.

**Why:** Once Epic's Track until is Max, the store item is the only thing marking a piece added after that as Realm Klash gear. Losing it lets the Kard plan spend kards on it and Kaskets count it.

**Context:** Found by the /ship review (passes 2-3 and the adversarial pass) on 2026-10-11 and deferred so the gear kard plan could ship (decisions 00b6ed88 and fd1db6e9). A dedicated Realm Klash flag on the card would remove most of these, but needs a save migration.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Test the gear lines on the Plan

**What:** Move the gear sentences in the Fusion Up Kard plan card (`src/views/PlanView.tsx`: the Next line, the not-enough line, the stuck note and the footer sentences) into a pure function in `src/ui.tsx`, the way `kasketLine` works, and table-test them in `src/engine.test.ts`.

**Why:** Seven wording branches have no test: "Next" with 0 left, "1 kard", the not-enough line, one stuck piece, next and stuck together, stuck after finished rows, and the gear-only footer.

**Context:** Deferred from the /ship coverage gate on 2026-10-11 (decision d5e7646c; the code carries a `gstack-shortcut` marker). Browser QA checked most of these lines by hand. No component-test library is needed.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Planner

### Work out the plan once per change

**What:** App.tsx works out the whole plan for its badge and PlanView works it out again, on every change and every minute. Share one result.

**Why:** Halves the planner's work on phones; Kaskets made each pass a little dearer.

**Context:** `src/App.tsx` (the `buildPlan(buildCtx(state), now)` for the badge) and `src/views/PlanView.tsx`. A memoised ctx and plan in the store, or a shared hook keyed on state and now. Deferred from the /ship review on 2026-10-10 to keep the Kasket release focused.

**Effort:** M
**Priority:** P3
**Depends on:** None

## Completed
