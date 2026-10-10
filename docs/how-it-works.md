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

Fusion Up Kards aren't one per level. Each step costs more, and each rarity (Diamond, Gold, Epic, Rare) has its own kards and its own cost table, editable in Settings → Fusion rules. The Diamond and gear costs come from the game: Diamond 1, 2, 3, 4, 5, 7, 10 and Epic and Rare gear 1, 3, 5, 7, 9, 12, 15. Gold uses the Diamond costs to F10, then the game's ascension costs: 10, 11, 12, 13, 15, 22, 24, 26, 28, 30.

| Step | F3→F4 | F4→F5 | F5→F6 | F6→F7 | F7→F8 | F8→F9 | F9→F10 | Total |
|---|---|---|---|---|---|---|---|---|
| Diamond kards | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 32 |

| Ascension step | F10→A1 | A1→A2 | A2→A3 | A3→A4 | A4→A5 | A5→A6 | A6→A7 | A7→A8 | A8→A9 | A9→A10 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gold Fusion Up Kards | 10 | 11 | 12 | 13 | 15 | 22 | 24 | 26 | 28 | 30 | 191 |
| Ascension Kards (not tracked) | 1 | 1 | 2 | 2 | 3 | 3 | 3 | 4 | 4 | 5 | 28 |

Gold kards also cover ascension (F10→A1 up to A9→A10), up to each card's own A5 (Stage I) or A10 (Stage II) cap, standing in for the one duplicate each step takes. Ascension Kards, the separate premium item every step also needs, aren't tracked or planned. You can edit the costs in Settings → Fusion rules.

Kards only work from F3 up. The Kard plan spends your kards one step at a time on the cheapest step available, because every step saves one pack copy no matter how much it costs. Guest cards count 1.5×, and ties go to the card with the fewest steps left to its goal, so one card is finished before another is started. It shows how many kards each card gets and how many are left over, or says when no card of that rarity can take kards yet, or names the cheapest next step when you don't have enough kards for it. The Wallet shows a kard count for each rarity tracked to max (Diamond and Gold by default, and Epic or Rare once their Track until is Max). A gear card's own max goal doesn't count: on Epic or Rare gear it means Realm Klash gear, which kards skip, even once the rarity's Track until is Max too.

A pack's value is the expected value of its drops (rolls × chance), added up across the drop table.

**Kaskets** have no saved drop table: their pool is worked out from your cards each time (`kasketPool` in `src/engine.ts`). It's the cards of the Kasket's rarity you don't own, minus the newest characters and gear from the latest game update (`KASKET_EXCLUDED` in `src/kaskets.ts`, replaced each update through the patch-notes skill), each with an even share of the one card a purchase gives. Realm Klash gear is left out: it's only sold for Blood Rubies. Once you own them all, the pool is the cards short of their own max, Gold cards still ascending included. That fallback only applies to a rarity tracked to max: Epic and Rare gear tracked to the kard threshold has its F3+ pieces deleted, so the app can't see most of what the Kasket would give and values it at 0. A Kasket whose rarity has been removed is valued at 0 too. When the planner buys several, a card counts as owned once it expects one copy of it, so after as many planned buys as there are new cards, the next one is valued from the fallback pool, which matches the game on average. Priority targets count a Kasket as dropping every card in its pool.

**Blood Ruby gear comes first.** Before Blood Rubies go to any pack, character or Kameo, the plan maxes the Realm Klash gear (equipment you've added as a Blood Ruby store item), one piece at a time: all of the first piece's copies, then the next. Fusion Up Kards never go to this gear: Blood Rubies come in every day (65 or more), while kards are much harder to get, so the gear is bought all the way to max and the Kard plan leaves it out. The default order is Shadow Sash, Moloch's Ball and Chain, Devastator, Datusha, Bane of the Moroi, then Bloody Tomahawk, and any other gear goes after them by name. Change it with the arrows in Settings → **Blood Ruby gear order**; the order syncs. That list only shows gear that's still to be maxed, so it's gone once the gear is done. If you're short for the next copy, the plan says how many more rubies you need and buys nothing else. A piece whose store item has hit its purchase limit is skipped until it has purchases again. When every piece is done, the leftover rubies are planned like any other currency.

**When the gear is maxed.** The app adds up the rubies every remaining copy costs, in gear order (each copy at its cheapest store item), and takes off your current balance. At the Blood Ruby daily income from Settings → Currencies (65 by default), the Blood Rubies part of the Plan's **What to buy** says when the whole set is maxed, and Settings → **Blood Ruby gear order** shows a date for each piece. Dates outside this year include the year. Season rewards and other rubies aren't predicted; once you enter them in the Wallet, the dates move closer. Store purchase limits aren't counted either, since a limit that runs out this season may reset in the next.

The planner works on each currency's balance separately, counting a balance below 0 (a logged purchase the typed balance didn't cover) as 0. It keeps buying the affordable pack with the best value per cost, and updates your expected progress after each buy so repeat buys are worth less. Limited-time packs get the `limitedBoost` urgency factor. Every weight and fusion table can be edited in Settings.

## Event schedule

MK Mobile Base keeps a copy of [mkmobileevent.com](https://mkmobileevent.com)'s schedule: shop packs (price, start, end, purchase limit), current and upcoming challenges, towers, and Realm Klash seasons. It doesn't include pack drop rates. Its API (`/api/events/schedule`) doesn't allow requests from other sites, so `npm run events` (`scripts/fetch-events.mjs`) saves it as `public/events.json`. The deploy workflow refreshes it on every push and also runs every day at 17:30 UTC, after the in-game rotations at 16:00. The site lists only the current and upcoming Realm Klash weeks, so the script keeps the weeks that ended in the last 4 weeks from the deployed copy (`scripts/schedule.mjs`); the app needs them to tell that a season was extended. The script fails rather than write a schedule it may have got wrong: when a page or section is missing, there are no shop packs or no current season, or a date isn't "Permanent" or in the site's format. If it fails or the site is down, the copy that's live now is deployed again, and the committed copy only if that can't be downloaded. The app shows the date of the schedule it has (when MK Mobile Base last captured it) in the season box and **In the shop**, since the site's capture can lag by days. Pack names the site gets wrong are mapped to the game's names in `src/events.ts`: "Bloodfire" and "Powerplay" are Blood & Fire and Power Play, and the site calls every Kameo pack a "Kameo Summon Pack", but only the Dragon Krystal ones are Summon Packs in the game (the Blood Ruby ones are "… Kameo Pack"). Names with a curly apostrophe keep the letter after it lowercase (Kollector’s Diamond Kasket, not Kollector’S). Packs already saved under the site's names are renamed. The app reads it when it starts, again on pull to refresh, and again when you come back to the app after an hour or more, so an app left open for days still gets the new schedule. The service worker keeps the last copy for offline use, and also uses it when the network hasn't answered in 4 seconds.

The app uses it for three things:

- **In the shop** (Packs): packs on sale or coming up that you haven't added. **Add** opens the pack editor with the name, currency, cost, dates and limit filled in, so you only enter drop rates for the cards you need. A pack you still have under Expired from an earlier run is suggested as a **Rerun**, which also copies that run's name and drop rates; one that expired after the shop's run began counts as the same run. **Not needed** hides a pack for good, for packs with none of your cards; this list syncs between devices. A permanent Blood Ruby pack (like the Kameo summon packs) isn't marked as leaving with the season.
- **Elder challenge dates** for challenge Kameos you still need, on the card and in the Plan.
- **The Realm Klash season end.** The site lists seasons a week at a time ("Circle of Shadow 2", then "Kold" twice), so back-to-back weeks with the same name count as one season. When a week is added after the saved end has passed, the season's items still on that end move to the new one. Since the site lists only the next week, a season that hasn't started yet counts as ending only once a different season is listed after it. Until then, an item entered ahead for it ends 2 weeks after it starts, or at the listed end if that's later, rather than after the one week listed so far.

## Card images

Cards → **Find images** looks up card art in two places:

1. **[MK Mobile Base](https://mkmobilebase.com/)** first. It has proper card art and the rarity of every character, Kameo and piece of equipment. Its API doesn't allow requests from other sites, so `npm run catalog` (`scripts/fetch-catalog.mjs`) downloads the whole catalog into `public/catalog.json`, and the deploy workflow refreshes it on every push. If the site is down during a deploy, or a category comes back empty, the copy that's live now is deployed again, and the committed copy only if that can't be downloaded. Names match regardless of word order, commas, "MKII" vs "MK2", and "Kold" vs "Kold War". Known misspellings on the site are mapped to the game's spelling in `src/catalog.ts` (so far only "Weather Warface", which is Weather Warfare).
2. **The [MK Mobile wiki](https://mortalkombat-mobile.fandom.com/)** for anything the catalog doesn't have, through its public API. It tries the card's page image, a wiki search, the equipment list pages, and art files uploaded to a character's page or before the page exists (for example `MK1 Sub-Zero.png`), skipping ability icons and pack banners.

The app also does this by itself when it opens: cards with no image, and cards with images from older wiki lookups, get MK Mobile Base art without tapping anything, including cards that arrive through sync. The button covers the same cards plus images that have stopped loading, and images from older wiki lookups, since some of those were stat screenshots rather than card art. Images you pasted yourself are left alone. If the wiki can't be reached, the catalog's art is still saved. Separately, each time Cards opens it compares every card with the catalog and lists any whose rarity disagrees with MK Mobile Base, with a button to switch them to the site's rarity. It runs whether or not any card needs art, because a card the catalog has gets its art straight away even under the wrong rarity. **Keep mine** saves the site's rarity on the card (`keptRarity`) so it isn't offered again; tapping the card's "site says" chip clears it. That's how Man in the Sky and Flame Forged Ferocity were found to be Rare, not Epic.

Only image URLs are saved; the art stays on those sites, and the service worker caches it for offline use. For anything neither site has, paste a URL with the card's **Image** button.
