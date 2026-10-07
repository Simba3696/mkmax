# User guide

How to use MK Max day to day, and what it tracks. For the maths behind the plan, see [How it works](how-it-works.md).

**[Open the app](https://simba3696.github.io/mkmax/).** It runs in any modern browser. You don't need the README's Quick start (`npm install`, `npm run dev`); those commands are for developers.

- [Getting started](#getting-started)
- [Words you'll see](#words-youll-see)
- [The screen and getting around](#the-screen-and-getting-around)
- [Cards tab](#cards-tab)
- [Packs tab](#packs-tab)
- [Reading the Plan](#reading-the-plan)
- [Settings](#settings)
- [What's tracked](#whats-tracked)
- [Your data, offline use and updates](#your-data-offline-use-and-updates)
- [When something looks wrong](#when-something-looks-wrong)
- [Notes for older saves](#notes-for-older-saves)

## Getting started

### Opening and installing

The app lives at [simba3696.github.io/mkmax](https://simba3696.github.io/mkmax/). There's nothing to download or sign up for: open that address in your browser and start adding cards.

To use it like a phone app, install it from your browser. It has no install button of its own:

- **iPhone or iPad:** open it in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).
- **Computer:** in Chrome or Edge, click the install icon at the right of the address bar, or use the menu's **Install MK Max** option.

Once installed, it's called **MK Max**, opens in its own window without the browser's bars, and uses a dark theme. Data is kept per browser (see [Where your data lives](#where-your-data-lives)), and on iPhone and iPad the home-screen app keeps its own copy apart from Safari. So install it before you enter much, or bring your data across with [sync](#sync-between-devices) or **Export backup** and **Import backup**.

- Open it online the first time. After that it opens offline too; see [Offline](#offline).
- It opens on **Plan**. Switching tabs puts `#plan`, `#packs`, `#cards` or `#settings` in the address, so a reload or a bookmark keeps your tab. Any other address after the `#` opens Plan. Each tab opens scrolled to the top.

### What a new install already has

- Three currencies, **Souls**, **Blood Rubies** and **Dragon Krystals**, all at 0. Blood Rubies already has a daily income of 65.
- Seven rarities: Diamond, Gold, Epic Equip, Rare Equip, Uncommon Equip, Diamond Kameo and Gold Kameo. **Has guest cards** is on for Diamond, Gold and both Kameos.
- No cards, no packs, the default priority weights, and 0 Fusion Up Kards for every rarity. The weights set how much the planner favours things like guest cards and reaching F3; you don't need to change them. See [Priority weights](#priority-weights).

You don't need to create currencies or rarities. You can rename, remove or add them in Settings.

### Trying it with sample data

Settings → Data → **Load sample data** loads a small made-up set:

- 10 cards, such as Klassic Sub-Zero and Guest Rambo.
- 4 packs: three ending 2 to 6 days from now, and one permanent.
- 1200 Souls, 900 Blood Rubies and 3 Diamond kards.

It **replaces everything** you've entered, and there's no Undo. With sync on, it's uploaded to your other devices too. When you're done looking, use **Erase everything** to start your own data.

### Setting up, in order

New to the terms? Skim [Words you'll see](#words-youll-see) first.

1. **Cards first.** Add the cards you're working on and their current fusion level. **Paste a list…** adds many at once.
   - A pack's drop picker only lists cards already on Cards, so add cards before packs. (The pack editor can also add a card; see [Adding a card from the editor](#entering-a-pack-from-its-info-screen).)
   - Add every card you're still maxing. Add Kameos only if you don't own them yet. A pack is only worth what the cards you track in it are worth.
   - Epic and Rare gear only needs adding while it's below F3, since kards finish it from there. Gear already at F3 or above is removed as soon as you add it, unless it's Realm Klash gear with **Goal** set to **Max**.
   - **Not owned** is its own level, below F0.
   - For each Gold card, set **Max** to **F10 (no ascension)**, **A5** or **A10**, as the card shows in the game. New and pasted Gold cards start at A10, so a card that doesn't ascend will otherwise ask for 10 copies too many and is never removed at F10.
   - See [Cards tab](#cards-tab).
2. **Packs.** Add the packs in the store, with the drop rates from each pack's in-game info screen.
   - Start from **In the shop** (the foldable card near the top of Packs, under the season box) → **Add**. It fills in the name, currency, cost, purchase limit and dates. You add the odds, fix **Cards per purchase** (it always comes in as 1), fix a cost of 0, and tick **Store item** for single-card store items. In the shop doesn't show when the event schedule hasn't loaded or has nothing new to suggest. Otherwise use **+ Add pack**.
   - A pack with no drop chances is worth nothing to the plan.
   - See [Entering a pack](#entering-a-pack-from-its-info-screen).
3. **Wallet on the Plan.** Enter your currency balances and Fusion Up Kards in the Plan's Wallet card. The plan then shows what to buy. Only Diamond and Gold have kard boxes by default: gear stops at F3 and you finish it with kards in the game yourself. See [Wallet](#wallet).
4. **Optional extras, once:**
   - Each currency's daily income (Settings → Currencies).
   - **Guest** ticks on guest cards.
   - Realm Klash gear: add each piece as Epic Equip with **Goal** set to **Max (F10, Realm Klash gear)**, add it as a Blood Ruby **Store item**, then set the order in Settings → Blood Ruby gear order.
   - The Realm Klash season end on Packs, only if the event schedule doesn't set it.

### The Get started card

Until you have at least one card and one pack, the Plan shows only a **Get started** checklist and the Wallet boxes. Steps 1 and 2 are crossed out once done. **Cards**, **Packs** and **Settings** in it are links.

- Step 3 asks for your currency balances and Fusion Up Kards, in the Wallet just below.
- Its last line points you to Settings to load the sample data and try the app first. See [Trying it with sample data](#trying-it-with-sample-data).

### What a working plan looks like

The Plan's sections, top to bottom:

- **Wallet:** your balances and kards.
- **What to buy:** how many of each pack to buy with each currency.
- **Fusion Up Kard plan:** where your kards should go.
- **Elder challenges:** challenge Kameos you need whose challenge is on or coming up.
- **Priority targets:** the cards whose next copy is worth most.
- **Pack ranking:** every pack compared by value per cost.

Each is explained under [Reading the Plan](#reading-the-plan).

## Words you'll see

| Word | What it means |
|---|---|
| **F0, F3, F10** | Fusion levels. Your first copy of a card is F0, and each level after that takes 1 duplicate. So F10 from nothing is 11 copies, and F3 is 4. |
| **Not owned, "—"** | You don't have the card yet. The level stepper shows it as "—". |
| **A1 to A10** | Ascension: Gold levels past F10, one copy each, up to the card's **Max**. |
| **Copies** | Chips like "5 to F10" and "2 to F3" count the copies still needed (including the first copy if you don't own the card), not levels. |
| **Fusion Up Kards (kards)** | An in-game item that raises a card one fusion step without a duplicate. They work from F3 up, each rarity has its own, and steps get more expensive toward F10. |
| **Kard threshold** | F3, the level where kards start to work. |
| **Kinds** | Diamond and Gold are characters. The "Equip" rarities are equipment (gear). Kameos are support cards, tracked only until you own one. |
| **Guest card** | A Diamond, Gold or Kameo card that's only in packs during its event. It counts 1.5× by default. |
| **Elder challenge** | A challenge event that comes around now and then and gives that character's Gold Kameo. |
| **Krypt gear, tower gear** | Gear you farm rather than buy, tagged with where it comes from. |
| **Realm Klash** | The Blood Ruby store, with 2-week seasons. Realm Klash gear is the Epic gear it sells, which stays from season to season and which you buy to max. |
| **Currencies** | Each has its own balance and is planned on its own, but card progress is shared across them. |
| **Store item, random pack** | A store item gives one guaranteed copy of a single card per purchase, so buying it levels the card. A random pack rolls a drop list, so you log what you pulled. |
| **Chance, cards per purchase** | Chance is the % per roll, copied from the in-game info screen. Cards per purchase is how many rolls one buy gives. |
| **Even pool** | One odds line shared by a group of cards ("X% for one of these"). |
| **Value, value per buy, efficiency** | Scores with no unit. See [Pack ranking](#pack-ranking). |
| **Limited-time pack, permanent** | A limited-time pack has an end date. A permanent pack has none. |
| **Buy, Save for, Next, Next best** | Lines in What to buy. See [What to buy](#what-to-buy). |

## The screen and getting around

### Phones

A header across the top shows **MK MAX**, "Pack planner" and, with sync on, the sync pill. A bar along the bottom has **Plan**, **Packs**, **Cards** and **Settings**. The current tab has a red line and a red icon.

### Tablets and desktops

On tablets and computers (768px wide and up), the tabs move to a rail on the left: Plan, Packs and Cards at the top, and the sync pill and **Settings** at the bottom. On wider screens the rail is wider and shows the full logo. Pages flow into columns on wide screens.

Swiping and pull to refresh need a touch screen. With a mouse, reload the page, or use Settings → **Sync now**.

### Switching tabs

Tap a tab, or swipe left or right on the page. The page follows your finger; let go past about a quarter of the screen (or flick) and it slides to the next tab, otherwise it springs back. Tapping a tab slides the same way. With Reduce Motion on, tabs switch without the slide. Swipes that start on a text field, inside a pop-up, on something that scrolls sideways, or right at the screen edge (where iOS has its own back gesture) are ignored.

The order is Plan, Packs, Cards, Settings. Swiping doesn't wrap from Settings back to Plan.

### Pull to refresh

Pull down from the top of any page. With sync on, it syncs now, re-reads the event schedule and checks for a new version of the app. Without sync, it reloads the app, which also picks up updates. Your data is kept either way. It doesn't work inside a pop-up, so an unsaved pack editor is never reloaded away.

It works only on touch screens, and only when the page is scrolled to the top. The ↻ turns gold when you've pulled far enough.

### Folding cards

Tap a card's heading on Plan (Wallet, What to buy, Pack ranking and so on) or Settings (Fusion rules, Currencies, Sync and so on) to fold it; tap again to open it. Folded cards stay folded on that device.

### Pop-ups

Pop-ups (like the pack editor) sit above the rest of the app and scroll on their own, so the buttons at the bottom can always be reached. Tapping outside one doesn't close it, so a stray tap can't throw away a half-entered pack; use ✕ or Cancel. The Escape key also closes one without saving. With a keyboard, Tab stays inside the pop-up, and closing it puts you back on the button that opened it. Saving a pack has Undo.

### Two-tap buttons

**Delete**, **Clear expired**, **Ended early**, **Disconnect this device**, **Load sample data** and **Erase everything** need two taps. The first tap changes the button to **Tap again to confirm** for 3 seconds.

### Undo

After a purchase, deleting a pack or card, clearing expired packs, or a card being removed for reaching its goal, an **Undo** bar shows for 8 seconds. It puts everything back as it was before that action. For a random pack, that includes the + taps on pulled cards. The bar goes away if a sync brings in changes from another device.

- The bar has **Undo** and ✕ (to close it).
- It also appears for saving a pack ("Saved …"), hiding a shop pack ("Hid …"), pasting a list ("Added N cards, updated M"), switching cards to MK Mobile Base's rarity ("rarity change for N cards"), ending a Realm Klash season early, removing a rarity or currency, **Reset weights**, and turning a rarity's kards off while it tracks to the kard threshold.
- Only the latest change can be undone.
- Undo puts back the whole app as it was, so anything else you changed while the bar was up (like a balance) is undone too.
- **Import backup**, **Load sample data**, **Erase everything** and a sync download clear the bar and can't be undone.
- **−1** on a pack has no Undo bar of its own.
- If a + in **What did you pull?** maxes a card, the bar then undoes only that tap.

### Sync pill

Shown only while sync is on. It reads "Sync on" or "Synced" and a time (green), "Syncing…" (grey), or "Sync error" or "Sync needs you" (red). Tap it to open Settings. See [Sync between devices](#sync-between-devices).

### Ending soon

The Packs tab shows a red count of packs the plan says to buy that end within 24 hours. Where the device supports app badges for installed web apps (for example desktop Chrome or Edge), the app icon shows the same count. It counts only packs in **What to buy**, not every pack ending within a day.

## Cards tab

### Cards and Tower gear

Two buttons at the top switch between your card list and the [Tower gear](#tower-gear) view. The tab always opens on **Cards**.

### Add card

- **Name:** use the card's full in-game name, character and variant ("Sub-Zero, Klassic" or "Klassic Sub-Zero": word order doesn't matter). Art lookup and Elder challenge tagging match on those words, so a missing or misspelled variant is what breaks them. Enter adds the card. **Add card** doesn't check for duplicates; **Paste a list…** does.
- **Rarity:** the list and its order come from Settings → Fusion rules. It starts on the first one (Diamond) and stays on whatever you picked last. Changing it resets the level and Max. Which other fields show depends on the rarity's kind.
- **Current level:** Not owned, F0 to F10, and A1 to A10 for Gold. It starts at Not owned and goes back to Not owned after each add, so set it for every owned card. Hidden for Kameos, which always start not owned. A card added already at its goal is removed straight away, with "… is maxed and removed" in the Undo bar.
- **Goal** (Epic and Rare gear): **F3 (Kards finish it)** or **Max (F10, Realm Klash gear)**. Max is how Realm Klash gear is tracked, and the Kard plan skips it, so don't use it for Krypt or tower gear you'd finish with kards. To plan kards for a gear rarity, set its **Track until** to Max in Settings → Fusion rules instead; the Goal choices then read **F3 (Kards finish it)** and **Max (F10)**. A card you set to Max before that stays Realm Klash gear and still says so; pick the plain **Max (F10)** under it to let kards go to it.
- **Max** (Gold): **F10 (no ascension)**, **A5** or **A10**. Diamond has no Max, since it stops at F10.
- **Guest card:** shown only when the rarity has guests. It's unticked again after each add.
- **Source** (equipment): **From packs/store**, **Krypt gear** or **Tower gear**. Tower gear adds a **Tower** box for the tower's name, which files the card under that tower on [Tower gear](#tower-gear). Gold Kameos on the challenge list are tagged **Elder challenge** automatically.
- **Add:** clears Name, level and Guest, and keeps Rarity, Goal, Max, Source and Tower for the next card. Adding one card has no Undo; delete it instead.

For Epic and Rare gear the form says it's "tracked only until F3. After that, your Fusion Up Kards can max it."

### Paste a list…

Tap **Paste a list…** and paste one card per line.

```
Gold Kameo
Jade, Lizard
-----
Kori Blade - Epic - Lin Kuei Tower - F2
Man in Control - Epic - Krypt Gear - Unowned
```

- **Just a name** (`Jade, Lizard`) goes in as not owned, using the rarity picked in Add card.
- **A heading line** that's just a rarity's full name (`Gold Kameo`, `Diamond Kameo`, `Epic Equip`) switches the rarity for the plain names after it, so a list copied from notes with headings and `-----` underlines works as-is. A heading must be the full name: a bare `Epic` line becomes a card called "Epic".
- **Details** go after ` - ` (an en or em dash works too), in any order:
  - Rarity: `Epic`, `Rare`, `Gold` and so on. Kameo rarities need their full name.
  - Where it comes from: `Krypt Gear`, or a tower name like `Lin Kuei Tower`, which tags it as tower gear and remembers the tower. Only gear can have one: a character or Kameo line with a Krypt or tower source is refused.
  - Level: `F2`, `A3` (ascension), or `Unowned`, `Not owned`, `None` or `New` for not owned.
- **Bullets and numbers** at the start of a line (`- `, `• `, `* `, `1. `, `1) `) are dropped, so a bulleted list from a notes app pastes with clean names.
- **Cards already in the app** get the new level and source instead of being added twice. They only match a card of the same rarity, and a pasted level can lower a card's level.
- Pasted cards are never guests, and pasted Gold cards get **Max** A10. Set both on the card afterwards where needed.

Under the box it shows what it will do: "New: …" by rarity, "updating N already listed", and "skipping N already listed" for cards with nothing to change or listed twice. Lines it can't use are listed with the reason and left out: Common gear, a level past the max, a line with details but no rarity, a Krypt or tower source on a card that isn't gear, or a part it doesn't recognise. The button reads **Add N, update M**. **Cancel** closes the box and keeps the text. Undo takes the whole batch back out.

### Search, filters and sort

- **Search** matches the text as typed, in order. (The pack editor's card picker is looser and matches words in any order.) Search and filters reset each time you open Cards.
- The rarity filter starts on **All rarities**. It also has **All characters** (Diamond and Gold), **All equipment** (Epic, Rare and Uncommon) and **All Kameos** (Diamond and Gold), as well as each single rarity.
- The source filter starts on **Any source**. It also has **Packs/store** (cards with no source), **Krypt gear**, **Tower gear** and **Elder challenge**.
- Each option in the rarity and source filters shows in parentheses how many cards it would list, given the search and the other filter.
- **Sort:** rarity (the default), fusion level highest or lowest first, or name. Rarity order is the order in Settings. Gold ascension counts as above F10, so A3 sorts before F9; not-owned cards and Kameos count as lowest. When sorted by fusion, a card moves as you tap + or −. The choice is remembered on each device and isn't synced.

### A card on the list

- **Thumbnail:** the border is the rarity's color. Colored initials mean there's no art, or it didn't load.
- **Chips:**
  - The rarity.
  - **guest**.
  - **site says** a rarity, on a card where you chose **Keep mine** in the rarity check. Tap it to have the card checked again (with Undo); if MK Mobile Base still disagrees, it's listed with the rarity fixes again.
  - The source (krypt, tower or Elder challenge), plus the tower name for tower gear.
  - Challenge dates: "challenge on now, until …" or "challenge Sep 30 – Oct 7". No chip means the event schedule doesn't list that challenge right now.
  - **N to F3**, while the card is below F3 and its goal is higher.
  - **N to** the goal, orange when the goal is F3, grey otherwise. Kameos show **Not owned yet**.
  - **kards give N**: shown once you have kards in the Wallet and the Kard plan gives some to this card.
- **− and +** move one level (one copy). + stops at the rarity's top level. Reaching the goal deletes the card, with Undo. Other level changes have no Undo.
- **Tap the name** to rename the card. It saves as you type, with no Undo, except that an empty box isn't saved. Spaces at either end are trimmed when you finish, and if you leave the box empty, the card gets back the name it had when you tapped it. While you rename it, the card stays listed even if the new name no longer matches the search. A card that has no name (from an older version or another device) shows **Unnamed**, which you can tap to name it. Renaming doesn't change an Elder challenge tag.
- **Goal**, **Max** and **Guest**, as in Add card.
- **Source:** you can change a card's source on the card itself. Equipment has From packs/store, Krypt gear and Tower gear; Kameos have From packs/store and Elder challenge; characters have none. Tower gear also has a **Tower** box for the tower's name, which saves as you type. Changing the source clears the tower name. A character or Kameo that an older pasted list tagged as Krypt or tower gear shows that source marked "not for this rarity", so you can set it back to From packs/store.
- **Image:** paste an image URL. Lookups never replace a working URL you pasted. If a pasted image stops loading, **Find images** may replace it. When the art came from MK Mobile Base or the wiki, a link opens the page it came from. Clearing the box on a card MK Mobile Base has brings its art back.
- **Delete** (two taps) removes the card and takes it out of every drop list, with Undo. Unlike removal at the goal, it keeps a store item that only sold that card, which is left with no item.

With no cards, or none that match, the list says "No cards match."

### Find images and rarity fixes

You usually don't need it: cards MK Mobile Base has get their art by themselves. **Find images (N)** shows only while some card still needs art (none yet, or an image that doesn't load), and looks it up on MK Mobile Base, then the MK Mobile wiki. It never replaces images you pasted unless they fail to load. "N not found online" means you'll need to paste a URL on those cards. If the wiki can't be reached, the art MK Mobile Base had is still saved, and the message says how many cards weren't looked up on the wiki, so you can try again later. More in [How it works](how-it-works.md#card-images).

Cards also lists cards whose rarity MK Mobile Base gives differently, for example a Kameo added under the wrong tier, or Epic gear that's really Rare. The check runs each time you open Cards, whether or not any card needs art. Each card has its own buttons: **Use the site's** switches that card to the site's rarity, and **Keep mine** keeps yours. With more than one card listed, **Use the site's for all** and **Keep mine for all** do the whole list at once. Both have Undo. A Kameo moved into Gold Kameo is tagged **Elder challenge** if it's on the challenge list (unless it already has a source), and one moved out of it loses that tag. A card you keep isn't listed again (on any synced device) unless MK Mobile Base later gives yet another rarity; instead it shows a **site says** chip, which you can tap to have it checked again. It only compares within the same kind, so a Kameo is never switched to a character rarity.

### Tower gear

Cards → Tower gear lists every card tagged as tower gear, grouped by the tower it drops from (the card's **Tower** box, or the tower name from a pasted list), with the towers that have the most gear left first. Each card shows how many copies it still needs, and you can change its level there. Maxed gear leaves the list like any other card.

- Gear tagged as tower gear with no tower name goes under "Tower not named", at the end. Type the tower's name in the card's **Tower** box on Cards to file it, or paste it again with its rarity and tower, like `Kori Blade - Epic - Lin Kuei Tower`. The rarity has to be there (a line with details but no rarity is refused), and it only updates a card of that same rarity.
- Tower names are grouped ignoring capitals, so "Lin kuei tower" goes under "Lin Kuei Tower".
- "N left" counts cards, not copies.
- Epic and Rare gear count copies only to F3, unless their goal is Max.
- There's no delete, goal or source control here; use the card on Cards.

The view says tower gear "isn't part of the plan", because it's farmed. It's planned for only when a pack you've entered drops it.

## Packs tab

### The list

Packs are split into three sections:

- **Available now**.
- **Coming up**: packs whose start date is still ahead.
- **Expired (N)**: folded; tap it to see them.

Expired packs are left out of the plan and Pack ranking. They stay until you clear them: **Clear expired** (two taps, with Undo) deletes them all. When the shop has a pack again that you still have under Expired, **In the shop** suggests it with **Rerun** instead of **Add**.

- **Sort** shows once you have 2 packs: **Ending soonest** (the default) or **Currency**, which groups each section's packs under a heading per currency, in the order they're listed in Settings. Sort choices are remembered on each device and aren't synced.
- **Summary line**, for example "400 Souls · 3 cards per buy · bought 2/5" for a random pack, or "300 Blood Rubies · store item · bought 0/2" for a store item. 2/5 means 2 bought of a 5-purchase limit.
- **Timing chip**, the same one as on the Plan: blue "starts in …", gold "… left" (red under 24 hours), or grey "permanent" or "expired". Countdowns update every minute.
- **Drop pills** show each card's chance per roll. "(deleted card)" means the card is gone from Cards. "No drops entered yet." means the pack has no odds.
- **Long drop lists:** a pack with more than 12 cards in its drop list shows the first 8 and a **+N more** pill. Tap it to see the rest, and **Show fewer** to fold it again. Lists start folded each time you open Packs.

With no packs, the tab says "No packs yet."

### Logging a purchase

On Packs, tap **I bought one**. This deducts the cost, and a store item also levels up its card. For random packs, tap + on each card you pulled. **−1** removes one purchase and refunds its cost, so it puts the balance back exactly as it was. To find a pack quickly, tap it in the Plan (under **What to buy** or **Pack ranking**); Packs opens scrolled to it, with it highlighted.

- The buttons show only on **Available now** packs.
- **I bought one** is greyed out once the purchase limit is reached.
- **I bought one** works even when your balance is lower than the cost, since the balance you typed may be out of date. The balance then goes below 0 until you type in the real one.
- **−1** on a store item also takes a copy off its card.
- After buying a random pack, **What did you pull?** opens: "Tap + for each copy you got." Cards you don't track can be ignored. **Done** closes it, and so does **−1**.

### Entering a pack from its info screen

Tap **+ Add pack** (or **Edit** on a pack).

- **Name:** use the in-game name, so **In the shop** recognises it.
- **Store item:** tick it for one guaranteed copy per purchase (for example the Realm Klash store). It keeps only the first drop, at 100%, and hides **Cards per purchase**. Unticking it leaves that 100% drop for you to fix. A Blood Ruby store item that sells equipment counts as Realm Klash gear.
- **Currency:** from Settings. Choosing Blood Rubies shows the season checkbox.
- **Cost:** the price of one purchase. It must be more than 0.
- **Cards per purchase:** how many cards one buy gives. Each card is one roll, so a wrong number scales the pack's value directly.
- **Purchase limit:** blank means unlimited. Copy the in-game limit; the plan never plans past it.
- **Already bought:** for purchases made before you added the pack. Changing it doesn't touch balances or cards. A purchase logged while the editor is open, on this device or another one, is kept when you save, unless you changed this box.
- **Starts (blank = now):** a start date still ahead puts the pack under **Coming up**. The plan can save for it, but you can't log a purchase until it starts.
- **Ends (blank = permanent):** an end date makes it a limited-time pack, which gets the urgency boost (1.25× by default), a countdown and the ending-soon badge.
- **Leaves when the Realm Klash season ends** and **Season ends** (Blood Rubies only): see [Realm Klash seasons](#realm-klash-season-box). When you add a Blood Ruby item or pack, the checkbox is ticked for everything except gear, and except a permanent Blood Ruby pack added from **In the shop** (one the schedule gives no end date, like the Kameo summon packs). A seasonal pack saved before any season date is entered stays permanent. A pack from a season that has already ended shows the normal **Ends** field. While the event schedule sets the season end, the editor shows that date and it can't be changed. An item that starts after the current season ends, like next season's character entered early, leaves when the season it starts in ends, and the editor shows that date under the field. That's the schedule's date once it lists the whole season, and otherwise 2 weeks after the changeover: the schedule shows only the next week, so a season starting next week looks one week long until its second week is listed. It keeps to that season when the current season's end changes: correcting the timer, **Ended early** or a schedule extension moves it with the changeover, so it ends 2 weeks after the new one, and an item that starts right as the season changes over starts at the new changeover.
- **Drop chances:** type the chance per card, per roll, as a percent. List only cards you track; the rest of the pool doesn't matter. **Total listed** turns red over 100%, which usually means a typo or a group rate typed on every card (use an even pool for those). It doesn't stop you saving.
- **Item** (store items): one card picker, with no %.

**Choosing a card for a drop:** type part of the name and pick from the list. Every word has to be in the name, in any order (`man sky` finds Man in the Sky). Each result shows its rarity and level ("new" means not owned), and cards already in the pack are left out. Up to 40 results show.

**Even pools:** for odds like "9% for one random Rare tower item", tap **+ Even pool…**, tick the cards you want, and enter the 9% and how many items the whole pool has (every item, the ticked ones included; nothing is added to or taken off that count). Each ticked card gets 9% ÷ that number. If you leave the pool size blank, it divides by the number of cards you ticked, so leave it blank only when the ticked cards are the whole pool. If you enter fewer items than you ticked, it uses the number ticked. Ticks stay when you switch the rarity list, so a pool can mix rarities. A card that's already listed, like one with its own 1.5% line, gets its pool share added to that chance, and the editor shows the before and after first.

**Adding a card from the editor:** under "Card not in your list yet? Add it here:", **Add card** adds a card to Cards straight away, even if you then cancel the pack. It joins the drops at 0%, so type its real chance (in a store item it becomes the item). It only asks for name, rarity and level, so set **Goal**, **Max**, **Guest** and **Source** on the card in Cards afterwards. Add Realm Klash gear on Cards first, with **Goal** set to **Max**: Epic gear at F3 or above added here is removed as soon as it's added.

**What stops Save pack:** the editor lists what's missing:

- "Give the pack a name."
- "Cost must be more than 0."
- "Cards per purchase must be at least 1."
- "Every drop row needs a card." (for a store item, "Choose the item being sold.")
- "The end time must be after the start time."

### Edit, Rerun, Delete

- **Edit** opens the pack in the editor.
- **Rerun** works on any pack. It opens a copy with the same name, purchases at 0 and dates cleared, and keeps the original. Tap Rerun on a seasonal item that comes back to add it to the new season.
- **Delete** needs two taps and has Undo.

### In the shop

**In the shop** lists packs from MK Mobile Base's event schedule that are on sale or coming up and aren't in the app yet. It hides itself when there's nothing to suggest. Its note says which day's schedule it's from.

- **Add** opens the pack editor with the name, currency, cost, purchase limit and dates filled in, in your local time. You enter the drop rates.
- **Rerun** shows instead of Add when you still have an earlier run of the pack under Expired. It fills in the same as Add, and also copies that run's name, drop rates, cards per purchase and store item setting. A pack that expired only after the shop's run began (a season you ended early, say) is the same run, so it isn't suggested.
- **Cards per purchase always comes in as 1**, so fix it for packs that give several cards.
- A pack the schedule has no price for comes in at cost 0, which you'll need to fix before saving.
- **Not needed** hides a pack for good, and the hidden list syncs. The 8-second Undo is the only way to bring it back.
- Suggestions match by name, so renaming a pack you added can bring its suggestion back.

More in [How it works](how-it-works.md#event-schedule).

### Realm Klash season box

The box at the top of Packs shows when the current Realm Klash season ends. It appears once there's a season date, the schedule covers the current season, or you have any Blood Ruby pack.

Realm Klash seasons last 2 weeks. Each season the Blood Ruby store swaps its characters, Kameos and Kameo packs, but the Realm Klash gear stays.

- **When MK Mobile Base's event schedule covers the current season**, its end date is used instead of your date and the 2-week guess, and seasonal items move to it by themselves. This includes a season the schedule extends by a week after your saved end has passed: if your saved end was the end of that season's earlier week, its items move from there to the new end. The box then shows that date, and which day's schedule it's from, and can't be edited. With sync on, the move waits until the app has tried to sync after opening, since another device may have made it already.
- **Otherwise**, enter the season's end from the in-game timer once. After that the app assumes each new season ends 2 weeks after the last one, so seasonal items get that end date, count as limited-time in the planner, and show up as expired when the season is over.
- **If the timer turns out to be different**, change the date here and every item from that season moves with it. The new date applies when you leave the box, press Enter or leave Packs, with Undo. You can also change it on any seasonal item, where it applies when you save the pack, with Undo. Saving moves the season only if you changed that date.
- **Seasons sometimes end early**, for example a short in-between season while an app update is delayed. When that happens, tap **Ended early** (two taps, with Undo): that season's items expire now, and the next season is assumed to end 2 weeks later until you enter its real end date.
- "N seasonal items leave then" counts the seasonal packs ending on that date.

## Reading the Plan

### Wallet

- Balances are edited only here. Clearing a box saves 0, and changes have no Undo.
- A balance below 0 means you logged a purchase it didn't cover. The plan counts it as 0; type in your real balance.
- Purchases you log come off the balance automatically. Income doesn't, so update your balances after playing.
- Kard boxes:
  - Diamond and Gold always show.
  - Epic and Rare show once their **Track until** is Max in Settings → Fusion rules. By default gear stops at F3 and you finish it with kards in the game yourself. A card's own **Goal** of Max doesn't add the box: that marks it as Realm Klash gear, which gets no kards.
  - Uncommon shows once you turn its kards on in Settings → Fusion rules. Kameos have no kards.
  - The app never takes kards off. After fusing in the game, lower the count here and raise the card on Cards.

### What to buy

Each currency with something worth buying gets its own part, headed "spend X of Y · Z left": what the plan spends (including Save for rows), your balance, and what's left.

- **Buy N×** is a pack to buy now. **Save for N×** is a pack that hasn't started yet: hold the currency for it. Save for rows have no **Bought one**.
- "value v" adds up the N buys, each worth a bit less than the one before, since every buy brings your cards closer to their goals.
- Gear comes first, then packs by end date, with permanent packs last.
- N never goes past the purchases left.
- Free, expired and worthless packs are never listed.

**Buying from the Plan:** each Buy row has **Bought one**. A store item is logged right there (cost deducted, card levelled). A random pack is logged too, then Packs opens at that pack with **What did you pull?** showing. If the purchase maxes a card, the Undo bar adds "· … is maxed and removed".

**How it chooses:** currencies are planned in the order listed in Settings, so a currency lower in the list sees cards the others already cover as worth less. The order is Souls, Blood Rubies, Dragon Krystals, with any currency you add at the end, and it can't be changed. The rest is in [How it works](how-it-works.md#scoring).

The note at the bottom repeats the basics: tap a pack to jump to it, Blood Ruby gear comes first, limited-time packs are listed soonest-ending first, and Save for means hold the currency.

### Next best and Next

- **Next best** is the pack the plan would buy next if you had more of that currency after its other buys. It can be a pack that hasn't started. "You need N more" is counted from what's left after the plan's buys.
- **Next** (Blood Rubies) is the next Realm Klash gear copy you can't afford yet. "Packs wait until the gear is maxed": no other Blood Ruby pack is planned until you can buy it.
- **When you can afford it:** in Settings → Currencies, the number next to each currency is roughly how much you get a day (Blood Rubies start at 65). With it, a **Next** or **Next best** hint says about how many days until you can afford that pack and on what date. "It ends before then." warns that the pack ends first. Leave the number empty for currencies with no steady income.

### Gear summary

With a daily Blood Ruby income set, the Blood Rubies part of **What to buy** says when all the Realm Klash gear will be maxed (for example "around Feb 6, 2027", or **now**). Without a daily income it shows how many rubies the gear takes in all and asks you to set one. Settings → Blood Ruby gear order sets the order and shows each piece's own date. Both go away once the gear is maxed. See [How it works](how-it-works.md#scoring).

### When What to buy is empty

"No worthwhile purchases…" means no pack in any currency, affordable or not, adds value. A currency with nothing to buy is just left out of What to buy. See [When something looks wrong](#when-something-looks-wrong).

### Fusion Up Kard plan

Hidden while every kard count is 0.

- Each rarity shows its kards, "uses U, L left over", and rows like "F3 → **F6** (6 kards)".
- Only cards at F3 or higher, below their goal, and not Realm Klash gear get kards.
- "No … card at F3 or higher yet, so these kards wait." means no card can take kards yet. When Realm Klash gear of that rarity is at F3 or higher, it reads "No … card at F3 or higher that kards can go to yet" and adds that Realm Klash gear gets none.
- "Not enough kards for any step yet: the cheapest next step costs N." means a card can take kards, but even its cheapest next step costs more kards than you have.
- It's advice only: nothing is applied to your cards.
- The plan counts the copies kards would cover as worth less, so it buys packs for the rest.

How kards are shared out is in [How it works](how-it-works.md#scoring).

### Elder challenges

Shows when MK Mobile Base's schedule lists a current or upcoming Elder challenge for a challenge Kameo you still need. The chip is red "on now, until …" or gold "start – end". The card's name has to match the challenge character. Play the challenge instead of buying packs for that Kameo.

### Priority targets

The 10 cards whose next copy is worth most.

- Each row shows guest and source chips, the level, "N to" the goal, "N to F3", and "not in any current pack" when no available or upcoming pack drops it.
- The chip on the right says which kind of copy comes next: **Unlock**, **To Kard threshold**, **Fusion** or **Kards cover it**.
- Krypt gear, tower gear and challenge Kameos that no current pack drops are left out.

### Pack ranking

Each currency lists its best 3 packs. **Show N more** lists the rest, and **Show fewer** goes back to the top 3. The full lists fold again when you reopen the Plan.

- The percentage is efficiency: value per cost, where 100% is the best pack in that currency.
- "value per buy" uses your cards as they are now.
- Up to 3 cards are listed under each pack, as "card: p per buy · about b buys per copy". The chance is of at least one copy per buy, and buys per copy is an average, not a guarantee.
- Upcoming packs, sold-out packs and free packs still appear. "Nothing you still need." at 0% often means no drop rates were entered.

**Why it differs from What to buy:** the ranking has no urgency boost, doesn't count repeat buys as worth less, and ignores purchase limits and your balance. So a pack at the top here may not be planned.

**What a value means:** values have no unit; bigger is better within a currency. As a rough guide, at the default weights one ordinary copy of a card is worth about 1 to 1.5, and more for a guest card, a first copy or a copy that gets a card to F3. The formula is in [How it works](how-it-works.md#scoring).

## Settings

Settings has, in order: **Sync between devices**, **Fusion rules**, **Currencies**, **Blood Ruby gear order** (only while gear is left to max), **Priority weights**, **Data**, and the version. Most edits here have no Undo.

### Sync between devices

Sync keeps your devices on the same data through a secret gist on your GitHub account, so you need a GitHub account.

- **Connecting:** go to Settings → Sync between devices and paste a classic GitHub token that has only the `gist` scope ([create one](https://github.com/settings/tokens/new?scopes=gist&description=MK%20Max%20sync); the link pre-fills it). A classic token starts with `ghp_`. Do this once on each device. Your data is saved as `mkmax-data.json` in a secret gist named "MK Max sync data".
- **The first time:** if there's no gist yet, it creates one with this device's data. If there is one, a device you haven't entered anything on yet simply downloads it. A device with changes of its own (cards, packs, balances or settings) asks which copy to keep, and the copy you don't pick is replaced. So connect a new device before entering anything on it.
- **When it syncs:** it uploads a moment after each change and downloads when the app opens or comes back to the foreground. It also checks every 2 minutes and when the device comes back online.
- **If both devices changed data** since they last synced, the app asks which copy to keep. It doesn't ask when both made the same change, like each moving the Realm Klash season end from the event schedule. The prompt shows each copy's card count and when it changed. Nothing is merged, and sync waits until you choose.
- **Device clocks:** a change always counts as newer than the last data this device synced, even if its clock is behind the other device's, so it still uploads.
- **Errors:** "GitHub rejected the token…" means the token is wrong or has expired; make a new one. "GitHub error 404" or "403" usually means the token is missing the gist scope. A message about "an old version of MK Max" means another device is running an old build: close MK Max on your other devices and open it again. A message about "a newer version of MK Max" means this device is the one running an old build: it neither downloads nor uploads until it's updated, so nothing gets saved back in the older format. To update it, pull down to refresh, or close MK Max and open it again. If you change anything on this device meanwhile, it asks which copy to keep once it's updated. A message that this version "can't read the data in your gist" means the same: this device leaves the gist alone, and doesn't ask which copy to keep, until an update can read it.
- **Sync now** syncs straight away.
- **Disconnect this device** (two taps) forgets the token on this device only. Your data and the gist stay, and other devices stay connected.
- **Token storage:** the token is kept in this browser on each device. It's never part of the synced data or of exported backups.

### Fusion rules

One box per rarity. Kameo rarities, including the built-in Diamond Kameo and Gold Kameo, show only **Name**, **Kind**, **Has guest cards**, **Color** and **Remove**, since a Kameo has no fusion steps. The others have:

- **Name:** renaming changes the label. **Paste a list…** uses the new name for headings and details.
- **Fusion Up Kards usable from:** the level where kards start. **No kards for this rarity** hides the kard costs. With no kards there's no threshold to stop at, so a rarity set to track until the kard threshold switches to **Max**, with Undo. Picking a level again leaves it on Max. An older save that still tracks to the kard threshold with no kards switches to Max once, when it loads. Uncommon gear has no kards unless you pick a level here and fill in its **Fusion Up Kards per step**, which start at 0.
- **Track until:** **Max**, or **Kard threshold** (F3). Switching to the threshold removes cards already at F3 or above, with a brief Undo.
- **Highest fusion:** the last F level; levels past it are ascension (A1, A2, …).
- **Kind:** Character, Equipment or **Kameo (only need one copy)**. It decides the Kameo weight, whether cards can be gear, whether they have a **Goal** control (equipment only), and which sources a card can pick. Kameo means only owning one counts. Switching a rarity to Kameo removes the cards of that rarity you already own straight away, with Undo. It also turns off its kards (and clears its kard count) and hides its fusion settings, since a Kameo has no fusion steps. Switching it back gives it 1 duplicate per level up to F10, which you can then edit.
- **Has guest cards:** shows the Guest checkbox on that rarity's cards. Unticking it only hides the checkbox, and it turns itself back on the next time the app loads while any card of that rarity is still a guest.
- **Color:** the rarity's color on badges and thumbnails.
- **Duplicates per step**, with **+ Level** and **− Level**. When the rarity has kards, the new step gets a kard cost straight away (usually 10, or 0 for Uncommon gear), which you can change under **Fusion Up Kards per step**. **− Level** removes cards that are now at or past the new top level, with a brief Undo.
- **Fusion Up Kards per step:** 0 means kards can't do that step.
- **Remove:** greyed out while any card uses the rarity. It has no confirm, but has Undo.

**+ Rarity** adds a new one.

### Currencies

- Each currency has a name and a per-day number: roughly how much you get each day. With it, the plan says when you can afford what it's saving for.
- Balances live in the Plan's Wallet, not here.
- **✕** is greyed out while a pack uses the currency. Removing one has Undo, which also brings back its balance and per-day number.
- **+ Currency** adds one.
- Only the Blood Rubies currency the app came with gets the Realm Klash gear handling. Renaming it is fine, but deleting it and adding a new one loses that, so use Undo if you remove it by mistake.
- The plan works through currencies in this order: Souls, Blood Rubies, Dragon Krystals, then any you add. There's no way to reorder them.

### Blood Ruby gear order

The Realm Klash gear still to max, in the order Blood Rubies buy it. Move pieces with ↑ and ↓; the order syncs. Until you move anything, pieces go in this order: Shadow Sash, Moloch's Ball and Chain, Devastator, Datusha, Bane of the Moroi, Bloody Tomahawk, then any others by name. Each piece's date assumes every piece above it is bought first. A piece whose store item is out of purchases is skipped for now.

### Priority weights

Every card is being maxed, so all cards count the same. These weights only decide which copies the planner goes after first.

| Weight | Default | What it does |
|---|---|---|
| Reaching the Kard threshold | 1.5 | Copies that get a card to F3, where kards start to work. |
| Unlocking a new card | 1.3 | The first copy of a card you don't own. |
| Guest / limited card | 1.5 | Guest cards, since they're gone once their event ends. |
| Kameos | 0.25 | Kameo copies, kept low so gear and characters come first. |
| Already covered by Kards | 0.3 | Copies your kards would cover anyway. |
| Challenge Kameo | 0.2 | Kameos an Elder challenge gives for sure. On top of the Kameos weight. |
| Close-to-max bonus | 0.5 | Extra value as a card nears max (0.5 = +50% at max). |
| Limited-time pack urgency | 1.25 | Prefers packs with an end date. Used in What to buy only. |

An emptied box saves 0. **Reset weights** puts the defaults back, with no confirm, but with Undo.

### Data

- **Export backup** downloads `mkmax-backup-YYYY-MM-DD.json`. The date is in UTC, so a backup made late in the evening or early in the morning can carry the next or previous day. It doesn't include the sync token, folded cards or sort choices.
- **Import backup** replaces everything with the file, with no confirm and no Undo. Older files are upgraded, and any card already at its goal is removed. With sync on, it's uploaded. A backup made by a newer version of MK Max isn't imported: the app looks for the update instead, so pull down to refresh, or close MK Max and open it again, then import it. A problem shows as "Import failed: …". Picking the same file again imports it again, so you can go back to a backup you just imported. A file with no rarities gets the built-in ones.
- **Load sample data** loads the made-up set described in [Trying it with sample data](#trying-it-with-sample-data).
- **Erase everything** puts the app back to a fresh install, with no Undo. With sync on, the empty data is uploaded, so every connected device is erased. To reset just one device, disconnect it first (or export a backup). Folded cards, sort choices and the token stay.
- **Download unreadable data** and **Discard it** show only when the saved data couldn't be read. See [Where your data lives](#where-your-data-lives).

### Version

The bottom of Settings shows which version you have and the date of that change, for example `Version 0ebc412 · 2026-09-27`. It only changes when the app itself does: the daily event schedule refresh keeps the same version. See [Updates](#updates).

## What's tracked

- **Diamond** characters to F10.
- **Guest** cards are Diamond, Gold or Kameo cards that only show up in packs during their event (Jason Voorhees only around Friday the 13th, for example), so they get extra weight. Tick **Guest** on the card; a rarity's Guest checkbox is controlled by **Has guest cards** in Settings, which is on for Diamond, Gold and both Kameos.
- **Gold** characters through F10 and then ascension (A1–A10, 1 copy per level). Not every Gold card ascends. Ascension came to some Gold cards in one update (up to A5) and to others in a later one (up to A10), so each card's **Max** is F10 (no ascension), A5 or A10. Neither MK Mobile Base nor the wiki records which cap a card has, so set it on the card; new Gold cards start at A10. Any other saved cap shows as "not a real cap" so it's easy to spot and fix. Fusion Up Kards work on ascension steps too, in place of the duplicate. Each step also takes Ascension Kards (1, 1, 2, 2, 3, 3, 3, 4, 4, 5 from F10→A1 to A9→A10), a separate premium item from season passes. MK Max doesn't track them: ascend whenever you have one, then raise the card here. The Fusion Up Kard cost of each ascension step comes from the game (see [How it works](how-it-works.md#scoring)). Saves that still had the old guess of 10 a step got the real costs once; costs you'd changed yourself were kept.
- **Epic** (purple) and **Rare** (blue) equipment only until F3 (4 copies), because Fusion Up Kards finish them. A card's **Goal** setting can switch that to max, which is how the Realm Klash gear is tracked: it's Epic gear you buy outright with Blood Rubies, one guaranteed copy per store purchase, and no Fusion Up Kards are planned for it.
- **Uncommon** (green) gear is tracked to max (F10), since it's farmed and maxed through tower runs. It has no Fusion Up Kards unless you turn them on in Settings → Fusion rules and enter the kard cost of each step. Tag it as tower gear and it shows under its tower on Cards → Tower gear.
- **Kameos** (Diamond and Gold) fuse to F10 in the game, but here you only track the ones you don't own yet. Add them under **Diamond Kameo** or **Gold Kameo**. Cards offers to switch a wrong tier to MK Mobile Base's (see [Find images and rarity fixes](#find-images-and-rarity-fixes)). When you get one, tap **+** and it's done, so it leaves the list (with Undo). Kameos sold in the Realm Klash store, or Kameo packs, go in as store items or packs like anything else.
- **Challenge Kameos:** the Gold Kameo of a challenge character (for example Kotal Kahn, Dark Lord) is earned by finishing that character's Elder challenge when it comes around as an event. These Kameos are tagged **Elder challenge**. The app has a list of the Gold challenge characters (from the MK Mobile wiki's Challenge Mode page), and any Gold Kameo you add that matches it is tagged automatically. Only the Gold Kameo rarity is tagged, and the name match ignores word order. You can change a card's source on the card itself, and removing the tag sticks. Challenges that no longer run are kept out of the list. When a challenge Kameo's challenge is on or coming up, its card shows the dates and the Plan lists it under **Elder challenges**.
- **Krypt and tower gear, and challenge Kameos** are tagged with their source. They're tracked, but only planned for when a pack you've entered actually drops them.
- **Done cards are removed:** when a card reaches its goal, the app deletes it. It's also removed from any pack drop lists, and a store item that only sold that card is deleted too. The goal is max for Diamond, the card's own ascension cap for Gold, F3 for Rare and Epic unless the card's **Goal** is Max (like the Realm Klash gear), F10 for Uncommon, and owning one for Kameos. Right after this happens you can use **Undo**. Any card that's already at its goal is removed when the app loads, when you import a backup, or when a sync brings one in.

**Not modelled on purpose:** Koins, duplicate refunds, tower and Krypt drops as pack sources, and guest-event dates. Urgency comes from the pack end dates you enter or the event schedule provides.

## Your data, offline use and updates

### Where your data lives

- Your data is saved in this browser only. Each browser, browser profile and device has its own copy.
- Clearing the site's data in the browser deletes it.
- Browsers can also clear it by themselves: Safari does for a site used in a Safari tab that hasn't been opened for 7 days, and others may when the device runs low on space. The app asks the browser to keep its data, but the browser decides. Some browsers, such as Firefox, ask you whether to let MK Max store data in persistent storage; choosing **Allow** protects it from being cleared, and if you close the question without choosing, it asks again next time. Installing the app (see [Opening and installing](#opening-and-installing)) or turning on [sync](#sync-between-devices) protects against this.
- If the browser won't let the app save (as in some private windows), changes are lost when the page closes, with no warning.
- Two open tabs of the app overwrite each other's saves. Keep one open.
- If the saved data can't be read, the app starts fresh and keeps the unreadable copy. Settings → Data then offers **Download unreadable data** and **Discard it** (two taps), and the Get started card on Plan points there. With sync on, the app downloads your gist's copy instead of uploading the empty data over it. If this version can't read the gist's copy either, sync leaves it alone and waits for an update.
- Settings → **Export backup** saves a copy, and [sync](#sync-between-devices) keeps your devices in step.
- Folded cards, sort choices and the sync token are kept per device. They aren't in backups and don't sync.

### Offline

- **Works offline:** everything you've entered, the plan, and logging purchases.
- The event schedule falls back to the last copy the app fetched, also when the connection is so slow it hasn't loaded in 4 seconds. Card art you've already seen is kept (up to 500 images, for 90 days).
- **Needs a connection:** new card art, **Find images** and sync. Sync catches up when you're back online.

### Updates

- An app left open only looks for a new version when you pull to refresh or import a backup from a newer version (or when it's fully closed and reopened). If one is out, the app reloads into it by itself.
- If a pop-up such as the pack editor is open when a new version is found, the app waits and reloads once you close it, so nothing you've typed is lost. It also waits while the Undo bar is showing (up to 8 seconds), so you can still undo a save that closed the pop-up.
- The daily event schedule refresh isn't a new version, so it doesn't reload the app.
- Updates never change your data, apart from the one-time upgrade of older saves.
- Settings shows which [version](#version) you have.

### Things the app does by itself

- Adds MK Mobile Base art to cards that have none.
- Takes the Realm Klash season end from the event schedule.
- Re-reads the event schedule when you come back after an hour or more.
- Updates countdowns every minute.
- Removes cards already at their goal when it loads.

The art doesn't count as a change for sync: every device adds the same art by itself, so it never makes two devices ask which copy to keep.

## When something looks wrong

**The Plan says "No worthwhile purchases".** Check for:

- Balances at 0, or too low for any pack.
- Packs with no drop chances entered.
- A cost of 0.
- Packs that have expired.
- Purchase limits used up.
- Packs that only drop maxed or untracked cards.
- Blood Rubies being held for the Realm Klash gear.

**A pack I added never shows in What to buy.** The same list, plus **Cards per purchase** or a chance entered wrong.

**Blood Ruby packs are missing while a seasonal item is leaving.** That's on purpose: gear comes first, and there's no override. Change the gear order, or wait until the gear is maxed.

**A pack tops Pack ranking but isn't planned.** See [Pack ranking](#pack-ranking).

**There's no Epic or Rare kard box.** See [Wallet](#wallet). Gear stops at F3 by default, and you finish it with kards in the game yourself. The box shows once that rarity's **Track until** is Max in Settings → Fusion rules. Setting a card's **Goal** to Max doesn't do it: that marks the card as Realm Klash gear, which gets no kards. If you set Krypt or tower gear to Max before, its Goal still reads **Max (F10, Realm Klash gear)** after you switch Track until; pick **Max (F10)** under it so the Kard plan counts it.

**I forgot to log purchases.** Tap **I bought one** for each (it takes off the cost). Or set **Already bought** in the editor (it doesn't touch balances) and fix the balance and card levels by hand. For a pull you logged by mistake, use − on Cards.

**A card disappeared.** It reached its goal, or was already at its goal when the app loaded, a backup was imported or a sync came in. Once the Undo bar has gone, add it again, along with its place in any packs. Changing **Track until** or **− Level** in Fusion rules can also remove cards.

**The schedule is wrong, or a pack is missing.** Check the schedule's date in the season box or **In the shop**: MK Mobile Base sometimes takes a few days to catch up, and if the date is much older than that, the daily refresh has stopped. Edit the pack, or add it with **+ Add pack**. The season box can't be overridden while the schedule covers the season. Times from the schedule are shown in your local time.

**I tapped Not needed by mistake.** Only the Undo bar brings it back.

**The sync pill says "Sync needs you" or "Sync error".** See [Sync between devices](#sync-between-devices).

**I lost my data.** See [Where your data lives](#where-your-data-lives). Import a backup, or connect sync to download the copy in your gist. If Settings → Data says the saved data couldn't be read, download it there before you discard it.

## Notes for older saves

These notes are about changes to saved data over time. You can skip them.

- Older saves got the Uncommon rarity added once; if you delete it, it stays deleted.
- When challenge tagging came in, Kameos already in the app were tagged once.
- Challenges that no longer run are taken off the challenge list (so far Klassic Ermac, whose Kameo comes from packs now), and a Kameo tagged before its challenge was retired gets untagged once.
- The older hand-kept per-tower counts were dropped.
