# MK Max

A PWA that helps decide which Mortal Kombat Mobile packs to buy to max out your cards.

```sh
npm install
npm run dev       # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test          # scoring/planner tests
npm run build     # production build in dist/ (installable PWA)
```

Data lives in the browser's localStorage. Use Settings → Export backup to save it or move it to another device.

`data/mkmax-onenote-import.json` is a starter backup transcribed from the OneNote "MK Mobile" page. Load it with Settings → Import backup.

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
