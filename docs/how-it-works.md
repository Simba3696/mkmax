# How it works

## Scoring

Each copy of a card is worth: `phase multiplier × guest multiplier × Kameo multiplier × challenge multiplier × (1 + closeness bonus × progress)`.

The Kameo multiplier (0.25 by default, set in Settings → Priority weights) keeps Kameos behind gear and characters. (Blood Rubies don't need it to put the Realm Klash gear first; see the gear order below.)

The challenge multiplier (0.2 by default, also in Priority weights) only applies to Kameos tagged **Elder challenge**. Finishing that Elder challenge gives you the Kameo for sure, so a Kameo pack is ranked mostly on the Kameos you can only get from packs. A challenge Kameo still counts a little, since the challenge might not come back for a while.

The phase depends on which copy it is:

- **Unlock**: the first copy of a card you don't own.
- **To Kard threshold**: copies that get the card to F3, where Fusion Up Kards become usable.
- **Fusion**: a normal copy.
- **Kards cover it**: copies your Fusion Up Kards would supply anyway, so they're worth less.
- **Done**: worth 0. Cards that reach their goal are removed, so they never get scored.

Fusion Up Kards aren't one per level. Each step costs more, and each rarity (Diamond, Gold, Epic, Rare) has its own kards and its own cost table, editable in Settings → Fusion rules. The Diamond costs come from the game; the others start as a copy of them until checked in-game.

| Step | F3→F4 | F4→F5 | F5→F6 | F6→F7 | F7→F8 | F8→F9 | F9→F10 | Total |
|---|---|---|---|---|---|---|---|---|
| Diamond kards | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 32 |

Gold kards also cover ascension (F10→A1 up to A9→A10), up to each card's own A5 or A10 cap. The ascension costs haven't been checked in-game yet, so each step starts at 10 kards (the same as F9→F10). You can edit them in Settings → Fusion rules.

Kards only work from F3 up. The Kard plan spends your kards one step at a time on the cheapest step available, because every step saves one pack copy no matter how much it costs. Guest cards count 1.5× and ties go to the card closest to max. It shows how many kards each card gets and how many are left over. The Wallet shows a kard count for each rarity that has cards past F3 still to go, so Epic kards show up once an Epic card other than Realm Klash gear has a max goal.

A pack's value is the expected value of its drops (rolls × chance), added up across the drop table.

**Blood Ruby gear comes first.** Before Blood Rubies go to any pack, character or Kameo, the plan maxes the Realm Klash gear (equipment you've added as a Blood Ruby store item), one piece at a time: all of the first piece's copies, then the next. Fusion Up Kards never go to this gear: Blood Rubies come in every day (65 or more), while kards are much harder to get, so the gear is bought all the way to max and the Kard plan leaves it out. The default order is Shadow Sash, Moloch's Ball and Chain, Devastator, Datusha, Bane of the Moroi, then Bloody Tomahawk, and any other gear goes after them by name. Change it with the arrows in Settings → **Blood Ruby gear order**; the order syncs. That list only shows gear that's still to be maxed, so it's gone once the gear is done. If you're short for the next copy, the plan says how many more rubies you need and buys nothing else. A piece whose store item has hit its purchase limit is skipped until it has purchases again. When every piece is done, the leftover rubies are planned like any other currency.

**When the gear is maxed.** The app adds up the rubies every remaining copy costs, in gear order (each copy at its cheapest store item), and takes off your current balance. At the Blood Ruby daily income from Settings → Currencies (65 by default), the Blood Rubies part of the Plan's **What to buy** says when the whole set is maxed, and Settings → **Blood Ruby gear order** shows a date for each piece. Dates outside this year include the year. Season rewards and other rubies aren't predicted; once you enter them in the Wallet, the dates move closer. Store purchase limits aren't counted either, since a limit that runs out this season may reset in the next.

The planner works on each currency's balance separately. It keeps buying the affordable pack with the best value per cost, and updates your expected progress after each buy so repeat buys are worth less. Limited-time packs get the `limitedBoost` urgency factor. Every weight and fusion table can be edited in Settings.

## Event schedule

MK Mobile Base keeps a copy of [mkmobileevent.com](https://mkmobileevent.com)'s schedule: shop packs (price, start, end, purchase limit), current and upcoming challenges, towers, and Realm Klash seasons. It doesn't include pack drop rates. Its API (`/api/events/schedule`) doesn't allow requests from other sites, so `npm run events` (`scripts/fetch-events.mjs`) saves it as `public/events.json`. The deploy workflow refreshes it on every push and also runs every day at 17:30 UTC, after the in-game rotations at 16:00. If the site is down, the committed copy is used. Pack names the site gets wrong are mapped to the game's names in `src/events.ts`: "Bloodfire" and "Powerplay" are Blood & Fire and Power Play, and the site calls every Kameo pack a "Kameo Summon Pack", but only the Dragon Krystal ones are Summon Packs in the game (the Blood Ruby ones are "… Kameo Pack"). Names with a curly apostrophe keep the letter after it lowercase (Kollector’s Diamond Kasket, not Kollector’S). Packs already saved under the site's names are renamed. The app reads it when it starts, again on pull to refresh, and again when you come back to the app after an hour or more, so an app left open for days still gets the new schedule. The service worker keeps the last copy for offline use.

The app uses it for three things:

- **In the shop** (Packs): packs on sale or coming up that you haven't added. **Add** opens the pack editor with the name, currency, cost, dates and limit filled in, so you only enter drop rates for the cards you need. **Not needed** hides a pack for good, for packs with none of your cards; this list syncs between devices. A permanent Blood Ruby pack (like the Kameo summon packs) isn't marked as leaving with the season.
- **Elder challenge dates** for challenge Kameos you still need, on the card and in the Plan.
- **The Realm Klash season end.** The site lists seasons a week at a time ("Circle of Shadow 2", then "Kold" twice), so back-to-back weeks with the same name count as one season.

## Card images

Cards → **Find images** looks up card art in two places:

1. **[MK Mobile Base](https://mkmobilebase.com/)** first. It has proper card art and the rarity of every character, Kameo and piece of equipment. Its API doesn't allow requests from other sites, so `npm run catalog` (`scripts/fetch-catalog.mjs`) downloads the whole catalog into `public/catalog.json`, and the deploy workflow refreshes it on every push. If the site is down during a deploy, the committed copy is used. Names match regardless of word order, commas, "MKII" vs "MK2", and "Kold" vs "Kold War". Known misspellings on the site are mapped to the game's spelling in `src/catalog.ts` (so far only "Weather Warface", which is Weather Warfare).
2. **The [MK Mobile wiki](https://mortalkombat-mobile.fandom.com/)** for anything the catalog doesn't have, through its public API. It tries the card's page image, a wiki search, the equipment list pages, and art files uploaded to a character's page or before the page exists (for example `MK1 Sub-Zero.png`), skipping ability icons and pack banners.

The app also does this by itself when it opens: cards with no image, and cards with images from older wiki lookups, get MK Mobile Base art without tapping anything, including cards that arrive through sync. The button covers the same cards plus images that have stopped loading, and images from older wiki lookups, since some of those were stat screenshots rather than card art. Images you pasted yourself are left alone. It also lists any card whose rarity disagrees with MK Mobile Base, with a button to switch them to the site's rarity. That's how Man in the Sky and Flame Forged Ferocity were found to be Rare, not Epic.

Only image URLs are saved; the art stays on those sites, and the service worker caches it for offline use. For anything neither site has, paste a URL with the card's **Image** button.
