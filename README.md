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

## Sync and hosting

- **Hosting:** pushing to `main` runs `.github/workflows/deploy.yml`, which tests and builds the app, then publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`. In the repo settings, set **Pages → Source** to **GitHub Actions** first. On the free plan, Pages needs a public repo.
- **Sync:** go to Settings → Sync between devices and paste a fine-grained GitHub token with **Gists: Read and write**. Do this once on each device. Your data is saved as `mkmax-data.json` in a secret gist named "MK Max sync data". It uploads a moment after each change and downloads when the app opens or comes back to the foreground. If both devices changed data since they last synced, the app asks which copy to keep.
- **Token storage:** the token stays in each device's localStorage. It's never part of the synced data or of exported backups.

## Card images

Cards → **Find images** looks up art on the [MK Mobile wiki](https://mortalkombat-mobile.fandom.com/) through its public API. It works best with names written like "Sub-Zero, Klassic" (name, variant). Only the image URLs are saved; the art stays on the wiki's CDN and the service worker caches it for offline use. For anything the wiki doesn't have, paste a URL with the card's **Image** button.

## What's tracked

Your first copy of any card is F0, and each level after that takes 1 duplicate. So F10 from nothing is 11 copies, and F3 is 4.

- **Diamond** characters to F10. Guest cards are Diamond cards flagged as limited-time.
- **Gold** characters through F10 and then ascension (A1–A10, 1 copy per level). Each card has its own cap of A5 or A10.
- **Blood Ruby** equipment from the Realm Klash store, to max. Store items give one guaranteed copy per purchase.
- **Rare and Epic** equipment only until F3 (4 copies). Fusion Up Kards finish them.
- **Krypt and tower gear** is tagged with its source. It's tracked but left out of pack planning.
- **Tower gear** also has a per-tower checklist (Cards → Tower gear).

## How it scores

Each copy of a card is worth: `tier weight × phase multiplier × guest multiplier × (1 + closeness bonus × progress)`.

The phase depends on which copy it is:

- **Unlock**: the first copy of a card you don't own.
- **To Kard threshold**: copies that get the card to F3, where Fusion Up Kards become usable.
- **Fusion**: a normal copy.
- **Kards cover it**: copies your Fusion Up Kards would supply anyway, so they're worth less.
- **Maxed** or **Skip**: worth 0.

Fusion Up Kards go to your highest-priority cards at F3 or above first.

A pack's value is the expected value of its drops (rolls × chance), added up across the drop table.

The planner works on each currency's balance separately. It keeps buying the affordable pack with the best value per cost, and updates your expected progress after each buy so repeat buys are worth less. Limited-time packs get the `limitedBoost` urgency factor. Every weight and fusion table can be edited in Settings.
