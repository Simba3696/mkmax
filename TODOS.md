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

## Completed
