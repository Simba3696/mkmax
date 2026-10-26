// Downloads the MK Mobile Base (mkmobilebase.com) character, equipment and Kameo catalog into public/catalog.json:
// each item's name, kind, rarity and thumbnail URLs. The site's API doesn't allow cross-site requests, so the
// app can't call it directly; it reads this file instead. Run by the deploy workflow, or: npm run catalog
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://mkmobilebase.com/api/categories';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mkmax catalog (https://github.com/Simba3696/mkmax)' };
const RARITIES = ['diamond', 'gold', 'silver', 'bronze', 'epic', 'rare', 'uncommon', 'common', 'legendary'];
/** Far past any real category (4 pages of 100 at most today), so a page count that never ends fails instead. */
const MAX_PAGES = 50;
/** The deployed app; the deploy workflow sets PAGES_URL. */
const LIVE = `${process.env.PAGES_URL ?? 'https://simba3696.github.io/mkmax'}/catalog.json`;
const FILE = new URL('../public/catalog.json', import.meta.url);
// The whole download takes seconds. Pages that each answer just inside 30 seconds could otherwise add up past the
// build job's 15 minutes, which would end the job before it falls back to the live copy.
const DEADLINE = Date.now() + 5 * 60_000;

async function fetchAll(category) {
  const items = [];
  let pages;
  for (let page = 1; ; page++) {
    if (Date.now() > DEADLINE) throw new Error(`${category} page ${page}: still downloading after 5 minutes`);
    // A stalled download fails after 30 seconds, so the deploy goes on with the live copy instead of waiting.
    const res = await fetch(`${API}/${category}/articles?per_page=100&page=${page}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${category} page ${page}: HTTP ${res.status}`);
    const { data, meta } = await res.json();
    // Without a usable page count the loop would stop early (and ship part of the catalog) or keep asking for pages
    // until the 5-minute deadline, so this fails it at once and the deploy keeps the live copy instead.
    const last = meta?.last_page;
    if (!Array.isArray(data) || !Number.isInteger(last) || last < 1 || last > MAX_PAGES) {
      throw new Error(`${category} page ${page}: unexpected page data`);
    }
    // A page count that shrinks while the pages are read would stop the loop early, and a site that sends no item
    // count would show no other sign of the missing pages.
    pages ??= last;
    if (last !== pages) throw new Error(`${category} page ${page}: the page count changed from ${pages} to ${last}`);
    items.push(...data);
    if (page >= last) {
      // An item that moved across a page boundary while the pages were read is skipped without any other sign.
      if (Number.isInteger(meta.total) && items.length !== meta.total) {
        throw new Error(`${category}: got ${items.length} items, the site says ${meta.total}`);
      }
      return items;
    }
  }
}

/** Rarity from the item's tags (e.g. "Diamond", "rare"), falling back to the excerpt ("Rare"). */
function rarityOf(item) {
  const fromTags = item.tags?.map((t) => t.slug?.toLowerCase()).find((s) => RARITIES.includes(s));
  if (fromTags) return fromTags;
  const text = (item.excerpt ?? '').replace(/<[^>]+>/g, ' ').toLowerCase();
  return RARITIES.find((r) => new RegExp(`\\b${r}\\b`).test(text)) ?? null;
}

const catalog = [];
for (const [category, kind] of [['characters', 'character'], ['equipment', 'equipment'], ['kameos', 'kameo']]) {
  const items = await fetchAll(category);
  // An empty category means the API has changed; failing keeps the deployed catalog rather than shipping one
  // without card art or rarities.
  if (!items.length) throw new Error(`${category}: no items`);
  // A site that ignored the page asked for would send page 1 again and again, which every other check here passes.
  if (new Set(items.map((i) => i.slug)).size !== items.length) {
    throw new Error(`${category}: the same item came back twice`);
  }
  for (const item of items) {
    // Kameo titles read "Baraka - Klassic Kameo"; drop the suffix so names match cards like "Baraka, Klassic".
    // The name is checked after that, so a Kameo titled just "Kameo" counts as having none.
    const title = typeof item.title === 'string' ? item.title : '';
    const name = kind === 'kameo' ? title.replace(/\s*Kameo$/i, '') : title;
    if (!name.trim()) throw new Error(`${category}: an item has no name`);
    catalog.push({ kind, name, rarity: rarityOf(item), slug: item.slug, image: item.image_thumb_2x_url ?? item.image_url });
  }
}
// Every card has art and a rarity today, so many without means the API renamed those fields; failing keeps the deployed
// catalog rather than shipping cards without them. A tenth of the whole catalog catches a kind losing them; art is also
// counted per kind and rarity (more than a tenth and more than 3), so a small group can't hide in the whole catalog.
// A new card or two the site hasn't finished (no art or rarity yet) fails neither.
for (const key of ['image', 'rarity']) {
  const missing = catalog.filter((c) => !c[key]).length;
  if (missing > catalog.length / 10) throw new Error(`catalog: ${missing} of ${catalog.length} items have no ${key}`);
}
for (const [group, cards] of Map.groupBy(catalog, (c) => `${c.kind} ${c.rarity ?? 'without a rarity'}`)) {
  const missing = cards.filter((c) => !c.image).length;
  if (missing > Math.max(3, cards.length / 10)) {
    throw new Error(`catalog: ${missing} of ${cards.length} ${group} cards have no image`);
  }
}
// A kind and rarity with far fewer cards than the newest earlier copy means the site lost them, not that the game
// removed them, so failing keeps the live catalog. That's the live copy, or the local one (the committed one in CI)
// when it's newer or the live one can't be read. After a real removal, CATALOG_ACCEPT_DROP=1 npm run catalog skips the
// comparison so the fresh catalog.json can be committed, and later deploys compare with that. Cards without a rarity
// aren't counted, so fewer of those never fails.
async function copy(load, what) {
  try {
    const c = await load();
    // A hand-edited copy's malformed items would break the counting below, so only real cards are compared.
    return Array.isArray(c?.items) ? { ...c, items: c.items.filter((i) => typeof i?.kind === 'string') } : null;
  } catch (e) {
    console.warn(`catalog: couldn't read the ${what} copy (${e.message})`);
    return null;
  }
}
async function earlierCopy() {
  const live = await copy(async () => {
    const r = await fetch(LIVE, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, 'live');
  const local = await copy(() => JSON.parse(readFileSync(FILE, 'utf8')), 'local');
  // A copy without a date counts as the oldest, not (as "undefined") the newest.
  const date = (c) => (typeof c.fetchedAt === 'string' ? c.fetchedAt : '');
  return [live, local].filter(Boolean).sort((a, b) => date(b).localeCompare(date(a)))[0];
}
const byKindAndRarity = (items) => {
  const counts = new Map();
  for (const { kind, rarity } of items) {
    if (rarity) counts.set(`${kind} ${rarity}`, (counts.get(`${kind} ${rarity}`) ?? 0) + 1);
  }
  return counts;
};
const earlier = process.env.CATALOG_ACCEPT_DROP === '1' ? null : await earlierCopy();
if (earlier) {
  const now = byKindAndRarity(catalog);
  for (const [key, was] of byKindAndRarity(earlier.items)) {
    const count = now.get(key) ?? 0;
    // More than a tenth and more than 3, so the site fixing a card or two in a small group doesn't fail every deploy.
    if (was - count > Math.max(3, was / 10)) throw new Error(`catalog: ${count} ${key} cards, down from ${was}`);
  }
}
catalog.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
writeFileSync(FILE, JSON.stringify({ source: 'https://mkmobilebase.com', fetchedAt: new Date().toISOString(), items: catalog }) + '\n');
const count = (k) => catalog.filter((c) => c.kind === k).length;
console.log(`catalog: ${count('character')} characters, ${count('equipment')} equipment, ${count('kameo')} kameos, ${catalog.filter((c) => !c.rarity).length} without a rarity`);
