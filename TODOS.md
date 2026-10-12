# TODOS

## Saving

### Let every button that can go stale save nothing when it has nothing to do

**What:** Return `noChange` (from `src/store.tsx`) wherever a tap can find nothing to change, and look rows up by id rather than by their place on screen:

- Clear expired with nothing left to clear (`PacksView.tsx`, which already counts `cleared === 0`).
- The + and − in "What did you pull?" (`PacksView.tsx`): `stepCard` clamps at 0 and max without saying so.
- Edits, deletes and rarity actions on a card or pack a sync has removed (`CardsView.tsx` patch, Delete, the rarity questions; the pack Delete in `PacksView.tsx`; `TowersPanel`).
- The season-end move in `App.tsx` when the latest copy already has that end.
- Settings rows addressed by their place on screen (`d.currencies.splice(i, 1)`, `d.rarities[ri]`): a stale tap can change or remove the wrong currency or rarity. Undo brings it back.
- A fuse tap after a sync changed the card's level or the Wallet fuses a different step than the button showed, and the Undo label gives the wrong kard count.
- `recordPurchase` doesn't check the purchase limit; only the button's `disabled` does.
- A gear ↑/↓ can move a piece past an on-sale piece a sync put between the two.

**Why:** Each of these still saves, stamps and syncs (and some offer an Undo) when a sync has changed things between the screen being drawn and the tap. That makes this device's copy look newest. The gear arrows, purchases and Fusion Up Kard buttons already follow this rule.

**Context:** Found by the /review Red Team and adversarial passes on clock-and-gear-taps (2026-10-13). All of these predate that branch and need a sync to land between render and tap. Test them the way `GearOrder.test.tsx` and `PacksView.test.tsx` do: two taps inside one `act()`, with `SyncLoop.prototype.nextStamp` spied to count saves.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Close "What did you pull?" on a −1 that a sync already took back

**What:** In `buy` (`src/views/PacksView.tsx`), close the pull step on any −1, even when `recordPurchase` logs nothing: `if (!p.store && (done || delta < 0)) setPulling(delta > 0 ? p.id : null)`.

**Why:** If another device took the purchase back and the sync lands between the screen being drawn and the tap, the −1 saves nothing (right) but leaves "What did you pull?" open for a purchase that no longer counts.

**Context:** Found by the /ship adversarial pass on clock-and-gear-taps (2026-10-13). The window is narrow: the −1 button goes once `purchased` is 0. Test it like `PacksView.test.tsx`'s stale −1: open the pull step, take the purchase back through a grabbed `update` in the same `act()` as the tap.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Cards

### Keep a half-typed card when the Cards tab switches to Tower gear

**What:** Tapping the Cards tab while on Cards switches to Tower gear, which unmounts the card list and drops anything typed there: the Add a card draft, a pasted list, a rename in progress, the search box and filters. Keep both pages mounted and hide the one not showing, or lift that state into `App`.

**Why:** A quick double tap from another tab is already ignored (`DOUBLE_TAP_MS`), but a deliberate tap while typing, or a habitual "tap the tab to scroll up", still loses unsaved input that Undo can't bring back.

**Context:** Chosen trade-off when the re-tap switch shipped on clock-and-gear-taps (2026-10-13): keep the switch the user asked for, guard only the double tap. Raised again by the /ship design and adversarial passes. `CardList` and `PasteList` keep their state in `useState` inside `src/views/CardsView.tsx`.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Event schedule

### Treat the first schedule download like the ones started on return

**What:** In `src/events.ts`, record when the shared download started inside `loadEvents` (for example `loadingSince`) and have `refreshIfOld` skip while `loaded` is pending and under 30 seconds old, whoever started it. Give `fetch` a `signal: AbortSignal.timeout(30_000)` so a hung download rejects through the existing catch instead of hanging. Then `refreshingSince` can go, and the comments on the first-download rule and `events.firstload.test.ts`'s Value line should say what the code does.

**Why:** Until a schedule has downloaded once, every return starts another download, even while the first is still on its way (an app switch during a slow first load), and a hung request is never cancelled, only replaced. What's shown stays right (downloads are numbered), so the cost is extra requests on a poor connection.

**Context:** Found by the /ship performance, maintainability, testing, Red Team and adversarial passes on clock-and-gear-taps (2026-10-13). The comments at the `refreshIfOld` rule currently describe a half-minute rule that only covers downloads started on return.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed
