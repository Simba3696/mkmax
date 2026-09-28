// Downloads the MK Mobile Base (mkmobilebase.com) character, equipment and Kameo catalog into public/catalog.json:
// each item's name, kind, rarity and thumbnail URLs. The site's API doesn't allow cross-site requests, so the
// app can't call it directly; it reads this file instead. Run by the deploy workflow, or: npm run catalog
import { writeFileSync } from 'node:fs';

const API = 'https://mkmobilebase.com/api/categories';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mkmax catalog (https://github.com/Simba3696/mkmax)' };
const RARITIES = ['diamond', 'gold', 'silver', 'bronze', 'epic', 'rare', 'uncommon', 'common', 'legendary'];

async function fetchAll(category) {
  const items = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}/${category}/articles?per_page=100&page=${page}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`${category} page ${page}: HTTP ${res.status}`);
    const { data, meta } = await res.json();
    items.push(...data);
    if (page >= meta.last_page) return items;
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
  for (const item of await fetchAll(category)) {
    // Kameo titles read "Baraka - Klassic Kameo"; drop the suffix so names match cards like "Baraka, Klassic".
    const name = kind === 'kameo' ? item.title.replace(/\s*Kameo$/i, '') : item.title;
    catalog.push({ kind, name, rarity: rarityOf(item), slug: item.slug, image: item.image_thumb_2x_url ?? item.image_url });
  }
}
catalog.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
writeFileSync(new URL('../public/catalog.json', import.meta.url), JSON.stringify({ source: 'https://mkmobilebase.com', fetchedAt: new Date().toISOString(), items: catalog }) + '\n');
const count = (k) => catalog.filter((c) => c.kind === k).length;
console.log(`catalog: ${count('character')} characters, ${count('equipment')} equipment, ${count('kameo')} kameos, ${catalog.filter((c) => !c.rarity).length} without a rarity`);
