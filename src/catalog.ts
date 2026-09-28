// Card catalog from MK Mobile Base (mkmobilebase.com): names, rarities and card art for every character, Kameo and
// piece of equipment. scripts/fetch-catalog.mjs downloads it into public/catalog.json at deploy time, because
// the site's API doesn't allow requests from other sites.
import type { Card, RarityRule } from './types';

export interface CatalogItem {
  kind: 'character' | 'equipment' | 'kameo';
  name: string;
  /** e.g. "diamond", "gold", "epic", "rare", "uncommon". */
  rarity: string | null;
  slug: string;
  image: string;
}

export const catalogPageUrl = (item: CatalogItem) =>
  `https://mkmobilebase.com/en/category/${{ character: 'characters', equipment: 'equipment', kameo: 'kameos' }[item.kind]}/${item.slug}`;

let loaded: Promise<CatalogItem[]> | null = null;

export function loadCatalog(): Promise<CatalogItem[]> {
  loaded ??= fetch(`${import.meta.env.BASE_URL}catalog.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`catalog.json: HTTP ${r.status}`);
      return r.json() as Promise<{ items: CatalogItem[] }>;
    })
    .then((d) => d.items)
    .catch((e) => {
      loaded = null; // let the next attempt retry
      throw e;
    });
  return loaded;
}

/**
 * The app rarity a catalog item belongs to: same kind, and an id equal to the site's rarity ("rare") or to
 * kind-rarity for Kameos ("kameo-gold"). Undefined when the app doesn't track that rarity.
 */
export function appRarityId(item: CatalogItem, rules: Iterable<RarityRule>): string | undefined {
  if (!item.rarity) return undefined;
  for (const r of rules) if (r.kind === item.kind && (r.id === item.rarity || r.id === `${item.kind}-${item.rarity}`)) return r.id;
  return undefined;
}

/** Order-free word key: "Scorpion, MKII Movie" and "Scorpion MK2 Movie" match; "the"/"of" and possessive 's are ignored. */
export function nameKey(name: string) {
  const s = name.toLowerCase().replace(/’/g, "'").replace(/'s\b/g, '').replace(/\bmkii\b/g, 'mk2');
  return [...new Set(s.split(/[^a-z0-9]+/).filter((w) => w && w !== 'the' && w !== 'of'))].sort().join(' ');
}

/**
 * The catalog entry for a card: same kind and name words. The app says "Kold" where the site says "Kold War",
 * and the site lists some original variants without a variant name (the Diamond "Jason Voorhees" is the wiki's
 * "Jason Voorhees/Nightmare"), so a no-variant entry of the card's own rarity is accepted as a last resort.
 */
export function findInCatalog(card: Card, rule: RarityRule | undefined, items: CatalogItem[]): CatalogItem | undefined {
  const kind = rule?.kind ?? 'character';
  const same = items.filter((i) => i.kind === kind);
  const key = nameKey(card.name);
  const exact = same.find((i) => nameKey(i.name) === key) ?? same.find((i) => nameKey(i.name) === nameKey(card.name.replace(/\bKold\b/i, 'Kold War')));
  if (exact) return exact;
  const base = card.name.split(',')[0].trim();
  if (base === card.name.trim()) return undefined;
  return same.find((i) => nameKey(i.name) === nameKey(base) && (i.rarity === card.rarityId || `${i.kind}-${i.rarity}` === card.rarityId));
}
