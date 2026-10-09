---
name: patch-notes
description: Turn Mortal Kombat Mobile release or patch notes into a plan for MK Max. Use when the user pastes MK Mobile update notes (new characters, equipment, towers, Kameos, Elder challenges, fusion or kard changes, Realm Klash changes) and wants the app changed to match.
---

# Patch notes

MK Mobile updates change things the app depends on. Some of it lives in the code, some updates by itself from MK Mobile Base, and some is only in the user's own data (their browser and gist), which you can't edit directly. The job is to sort every line of the notes into one of those, agree a plan with the user, then make the changes.

Don't edit anything until the user has agreed the plan.

## 1. Read first

- `AGENTS.md`, especially "Game rules the code depends on". A note that changes one of those rules means updating that list too.
- `docs/how-it-works.md` (scoring, the event schedule, card images).
- The places listed under "Code" below, so you know the current values before proposing new ones.

## 2. Sort each line of the notes

Go through the notes line by line. Every line lands in exactly one bucket.

### Code: needs a change in the repo

| The notes say | Where it lives | Migration? |
|---|---|---|
| Fusion Up Kard costs changed | `DIAMOND_KARD_COSTS`, `GEAR_KARD_COSTS`, `ASCENSION_KARD_COSTS` in `src/defaults.ts` | Yes, once, only where the save still has the old default (see version 12 and 13 in `src/normalize.ts`) |
| Duplicates per level, F levels or the F3 kard threshold changed | `defaultRarities()` in `src/defaults.ts`, `kardCost` and `targetLevel` in `src/engine.ts` | Yes |
| New ascension caps (beyond F10, A5, A10) | `ascensionCaps` in `src/engine.ts`, the Max select in `src/views/CardsView.tsx` | Maybe, if saved caps change meaning |
| A new kind of card or rarity | `defaultRarities()` in `src/defaults.ts`, `RarityRule['kind']` in `src/types.ts` | Yes, added once so deleting it sticks (see version 6, Uncommon) |
| New Gold Elder challenge characters | `CHALLENGE_CHARACTERS` in `src/challenges.ts` | No: new Gold Kameos are tagged when added. Tagging Kameos already in the app needs one |
| A challenge taken out of rotation | `RETIRED_CHALLENGES` in `src/challenges.ts` | Yes, to untag those Kameos once (see version 7) |
| New Realm Klash gear, or a change to the gear | `DEFAULT_GEAR_ORDER` in `src/engine.ts` | No, unless saved gear order needs fixing |
| Realm Klash season length changed | `SEASON_DAYS` in `src/engine.ts` | No |
| A new currency | `defaultState()` in `src/defaults.ts`, `currencyFor` in `src/events.ts` | Yes, added once |
| MK Mobile Base or its schedule misspells a new card or pack | `SITE_TYPOS` in `src/catalog.ts`, `SITE_PACK_NAMES` in `src/events.ts` | Only to rename names already saved (see version 9) |

For anything that needs a migration, use the `save-migration` skill.

### Automatic: no change needed

- **New characters, Kameos and equipment, their rarities and card art** come from MK Mobile Base's catalog (`npm run catalog`, refreshed on every deploy and daily).
- **Shop packs, towers, Elder challenge dates and Realm Klash seasons** come from its event schedule (`npm run events`, same refresh).

After the update is live, run `npm run catalog` and `npm run events` locally to check MK Mobile Base has the new content yet. If it doesn't, say so: the app picks it up on the first refresh after the site does. Don't commit those files just to get the new data; the deploy refreshes them.

### The user's data: give them something to paste

New cards the user wants to track, level changes, and tower gear live only in their browser and gist. Give them a **Paste a list…** block for Cards, one card per line:

```
Kori Blade - Epic - Lin Kuei Tower - F2
Man in Control - Epic - Krypt Gear - Unowned
Gold Kameo
Jade, Lizard
```

- Details after ` - `, in any order: rarity (`Epic`, `Rare`, `Gold`, …; Kameo rarities need their full name), source (`Krypt Gear`, or a tower name with `Tower` in it; gear only), and level (`F2`, `A3`, or `Unowned`).
- A line with details must name the rarity.
- A line that's just a rarity's full name (`Gold Kameo`) sets the rarity for the plain names after it.
- Cards already in the app get the new level and source instead of being added twice, but only within the same rarity.
- Use the game's card names. Matching ignores word order and punctuation, so `Sub-Zero, Klassic` and `Klassic Sub-Zero` are the same card.
- Paste a list can't change a card's rarity, goal or guest flag. For those, tell the user what to change on the card.

For bigger changes to their data, they can export a backup (Settings → Data → **Export backup**). Edit the file, and they import it back.

### Not modelled: say so and skip

The AGENTS.md list of things the app deliberately doesn't model:
- Koins
- duplicate refunds
- tower or Krypt drops as pack sources
- guest-event dates
- Ascension Kards

A note about one of these needs no change. Mention it so the user knows it was read.

### No effect on the app

Balance changes (stats, abilities, damage), bug fixes, UI changes in the game, and new modes the planner doesn't touch. List them in one line so the user can see nothing was missed.

## 3. Present the plan

Show the user one list, grouped by the buckets above. For each item, give:
- the note line;
- what you'd change, and where;
- whether it needs a migration.

Ask about anything the notes leave out. Never guess a number the notes don't give, such as a kard cost or a new cap; ask, or leave it for the user to check in the game. Then wait for the user to agree.

## 4. Make the changes

- Code changes follow AGENTS.md:
  - tests for engine and normalize changes;
  - the docs updated in the same change, including the game-rules list in AGENTS.md when a rule changed;
  - `npm run lint`, `npm test` and `npm run build` all passing.
- Commit with a plain subject saying what the user sees, like the existing history (for example "Give Gold ascension the game's Fusion Up Kard costs …").
- Give the user the Paste a list block last, with a sentence on where to paste it (Cards → **Paste a list…**).
