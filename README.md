# MK Max

A PWA that helps decide which Mortal Kombat Mobile packs to buy to max out your cards.

```sh
npm install
npm run dev       # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test          # scoring/planner tests
npm run build     # production build in dist/ (installable PWA)
```

Data lives in the browser's localStorage. Use Settings → Export backup to save it or move it to another device.

`public/onenote-import.json` is starter data transcribed from the OneNote "MK Mobile" page. To load it, use Settings → Load OneNote data, or open the app with `?starter` (for example `http://localhost:5173/?starter`). The `?starter` link only loads the file when the app has no cards yet, so it never overwrites your progress.

## Everyday use

- **Recording purchases:** on Packs, tap **I bought one**. This deducts the cost, and a store item also levels up its card. For random packs, tap + on each card you pulled. **−1** removes one purchase and refunds its cost.
- **Undo:** after a purchase, deleting a pack or card, clearing expired packs, or a card being removed for reaching its goal, an **Undo** bar shows for 8 seconds. It puts everything back as it was before that action. For a random pack, that includes the + taps on pulled cards. The bar goes away if a sync brings in changes from another device.
- **Switching tabs:** tap a tab, or swipe left or right on the page. The page follows your finger; let go past about a quarter of the screen (or flick) and it slides to the next tab, otherwise it springs back. Tapping a tab slides the same way. With Reduce Motion on, tabs switch without the slide. Swipes that start on a text field, inside a pop-up, on something that scrolls sideways, or right at the screen edge (where iOS has its own back gesture) are ignored.
- **Done cards are removed:** when a card reaches its goal, the app deletes it. It's also removed from any pack drop lists, and a store item that only sold that card is deleted too. The goal is max for Diamond, the card's own ascension cap for Gold, and F3 for Rare and Epic, except Epic cards set to a max goal (like the Realm Klash gear). Right after this happens you can use **Undo**. Any card that's already at its goal is removed when the app loads, when you import a backup, or when a sync brings one in.
- **Which version you have:** the bottom of Settings shows the commit and build date, for example `Version 0ebc412 · 2026-09-27`. An installed iPhone app only picks up a new deploy after it's fully closed and reopened, so if the version is behind, swipe the app away in the app switcher and open it again.
- **Pull to refresh:** pull down from the top of any page. With sync on, it syncs now. Without sync, it reloads the app, which also picks up updates. Your data is kept either way.

- **Layout:** only the content area scrolls; the header and tab bar are fixed rows around it, not bars floating over a scrolling page. iPhone Safari can strand floating bars mid-screen when the scroll position jumps during a scroll (as on a tab switch), and this layout avoids that.

## Sync and hosting

- **Hosting:** pushing to `main` runs `.github/workflows/deploy.yml`, which tests and builds the app, then publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`. In the repo settings, set **Pages → Source** to **GitHub Actions** first. On the free plan, Pages needs a public repo.
- **Sync:** go to Settings → Sync between devices and paste a classic GitHub token that has only the `gist` scope ([create one](https://github.com/settings/tokens/new?scopes=gist&description=MK%20Max%20sync)). Do this once on each device. Your data is saved as `mkmax-data.json` in a secret gist named "MK Max sync data". It uploads a moment after each change and downloads when the app opens or comes back to the foreground. If both devices changed data since they last synced, the app asks which copy to keep.
- **Token storage:** the token stays in each device's localStorage. It's never part of the synced data or of exported backups.

## Card images

Cards → **Find images** looks up card art in two places:

1. **[MK Mobile Base](https://mkmobilebase.com/)** first. It has proper card art and the rarity of every character, Kameo and piece of equipment. Its API doesn't allow requests from other sites, so `npm run catalog` (`scripts/fetch-catalog.mjs`) downloads the whole catalog into `public/catalog.json`, and the deploy workflow refreshes it on every push. If the site is down during a deploy, the committed copy is used. Names match regardless of word order, commas, "MKII" vs "MK2", and "Kold" vs "Kold War".
2. **The [MK Mobile wiki](https://mortalkombat-mobile.fandom.com/)** for anything the catalog doesn't have, through its public API. It tries the card's page image, a wiki search, the equipment list pages, and art files uploaded to a character's page or before the page exists (for example `MK1 Sub-Zero.png`), skipping ability icons and pack banners.

The app also does this by itself when it opens: cards with no image, and cards with images from older wiki lookups, get MK Mobile Base art without tapping anything, including cards that arrive through sync. The button covers the same cards plus images that have stopped loading, and images from older wiki lookups, since some of those were stat screenshots rather than card art. Images you pasted yourself are left alone. It also lists any card whose rarity disagrees with MK Mobile Base, with a button to switch them to the site's rarity. That's how Man in the Sky and Flame Forged Ferocity were found to be Rare, not Epic.

Only image URLs are saved; the art stays on those sites, and the service worker caches it for offline use. For anything neither site has, paste a URL with the card's **Image** button.

## What's tracked

Your first copy of any card is F0, and each level after that takes 1 duplicate. So F10 from nothing is 11 copies, and F3 is 4.

- **Diamond** characters to F10.
- **Guest** characters are Diamond or Gold cards that only show up in packs during their event (Jason Voorhees only around Friday the 13th, for example), so they get extra weight. Tick **Guest** on the card; a rarity's Guest checkbox is controlled by **Has guest cards** in Settings.
- **Gold** characters through F10 and then ascension (A1–A10, 1 copy per level). Each card has its own cap of A5 or A10.
- **Epic** (purple) and **Rare** (blue) equipment only until F3 (4 copies), because Fusion Up Kards finish them. A card's **Goal** setting can switch that to max, which is how the Realm Klash gear is tracked: it's Epic gear you buy outright with Blood Rubies, one guaranteed copy per store purchase.
- **Uncommon** (green) gear only appears in the tower checklist, since it's maxed through tower runs.
- **Kameos** (Diamond and Gold) fuse to F10 in the game, but here you only track the ones you don't own yet. Add them under **Diamond Kameo** or **Gold Kameo**. If you pick the wrong tier, **Find images** offers to switch it to MK Mobile Base's. When you get one, tap **+** and it's done, so it leaves the list (with Undo). Kameos sold in the Realm Klash store, or Kameo packs, go in as store items or packs like anything else.
- **No priority tiers:** every card is being maxed, so all cards count the same. Guest cards get extra weight only because they're gone once their event ends.
- **Krypt and tower gear** is tagged with its source. It's tracked but left out of pack planning.
- **Tower gear** also has a per-tower checklist (Cards → Tower gear).

## How it scores

Each copy of a card is worth: `phase multiplier × guest multiplier × Kameo multiplier × (1 + closeness bonus × progress)`.

The Kameo multiplier (0.25 by default, set in Settings → Priority weights) keeps Kameos behind gear and characters. For example, Blood Rubies go to the Realm Klash gear first, and to Kameos once that gear is maxed.

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

Kards only work from F3 up and only raise fusion, not Gold ascension. The Kard plan spends your kards one step at a time on the cheapest step available, because every step saves one pack copy no matter how much it costs. Guest cards count 1.5× and ties go to the card closest to max. It shows how many kards each card gets and how many are left over. The Wallet shows a kard count for each rarity that has cards past F3 still to go, so Epic kards show up once any Epic card has a max goal.

A pack's value is the expected value of its drops (rolls × chance), added up across the drop table.

The planner works on each currency's balance separately. It keeps buying the affordable pack with the best value per cost, and updates your expected progress after each buy so repeat buys are worth less. Limited-time packs get the `limitedBoost` urgency factor. Every weight and fusion table can be edited in Settings.

## Icons

The icon is a gold-ringed red medallion with a double up-chevron. `public/icon.svg` is the source. The PNGs next to it are rendered from it: `icon-192.png` and `icon-512.png` for the manifest, `icon-maskable-512.png` (the mark padded for Android's crop), and `apple-touch-icon.png` (180px). `public/logo-mark.svg` is the medallion without its background tile, used in the header. If you change the design, re-render all four PNGs. Phones cache home-screen icons, so remove the app and add it again to see a new one.

The tab bar icons are inline SVGs in `src/icons.tsx`. They use the current text color, so the active tab's icon turns red.
