// Card catalog from MK Mobile Base (mkmobilebase.com): names, rarities and card art for every character, Kameo and
// piece of equipment. scripts/fetch-catalog.mjs downloads it into public/catalog.json at deploy time, because
// the site's API doesn't allow requests from other sites.
import type { Card, MaxedCard, RarityRule } from './types';

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

/**
 * Words MK Mobile Base misspells, mapped to the game's spelling ("Weather Warface" is the game's Weather Warfare). A
 * word the site splits in two is joined in nameKey instead ("Sub-Zero, Grand Master" is the game's Grandmaster).
 */
const SITE_TYPOS: Record<string, string> = { warface: 'warfare' };

/** Order-free word key: "Scorpion, MKII Movie" and "Scorpion MK2 Movie" match; "the"/"of" and possessive 's are ignored. */
export function nameKey(name: string) {
  const s = name.toLowerCase().replace(/’/g, "'").replace(/'s\b/g, '').replace(/\bmkii\b/g, 'mk2').replace(/\bgrand[^a-z0-9]*master\b/g, 'grandmaster');
  const words = s.split(/[^a-z0-9]+/).filter((w) => w && w !== 'the' && w !== 'of').map((w) => SITE_TYPOS[w] ?? w);
  // The app says "Kold" where MK Mobile Base says "Kold War": one card, so one key (the list, the Maxed record and art).
  const kold = words.includes('kold');
  return [...new Set(words.filter((w) => !(kold && w === 'war')))].sort().join(' ');
}

// The catalog's items by kind and name key, in catalog order. Built once per catalog, so checking a few hundred cards
// (the rarity check runs on every save, Tower gear taps included) doesn't rescan every item for each one.
const indexes = new WeakMap<CatalogItem[], Map<string, CatalogItem[]>>();
function catalogIndex(items: CatalogItem[]) {
  let index = indexes.get(items);
  if (!index) {
    index = new Map();
    for (const i of items) {
      const k = `${i.kind}|${nameKey(i.name)}`;
      index.set(k, [...(index.get(k) ?? []), i]);
    }
    indexes.set(items, index);
  }
  return index;
}

/**
 * The catalog entry for a card: same kind and name words (nameKey reads "Kold" and the site's "Kold War" as one),
 * and the site lists some original variants without a variant name (the Diamond "Jason Voorhees" is the wiki's
 * "Jason Voorhees/Nightmare"), so a no-variant entry of the card's own rarity is accepted as a last resort.
 */
export function findInCatalog(card: Card, rule: RarityRule | undefined, items: CatalogItem[]): CatalogItem | undefined {
  const kind = rule?.kind ?? 'character';
  const index = catalogIndex(items);
  const named = (name: string) => index.get(`${kind}|${nameKey(name)}`) ?? [];
  const exact = named(card.name)[0];
  if (exact) return exact;
  const base = card.name.split(',')[0].trim();
  if (base === card.name.trim()) return undefined;
  return named(base).find((i) => i.rarity === card.rarityId || `${i.kind}-${i.rarity}` === card.rarityId);
}

/** One rarity's completion: how many of the cards MK Mobile Base lists under it are on the Maxed record. */
interface RarityCompletion {
  rarityId: string;
  maxed: number;
  total: number;
}

/**
 * Completion for each rarity MK Mobile Base lists cards of, in the rarities' order: Maxed record entries it lists
 * under that rarity, out of every card it lists there, matched by name as card art is. Entries it doesn't list there
 * (a card it doesn't have yet, or one filed under another rarity) are returned as `unlisted` and not counted, so a
 * figure never passes 100%.
 */
export function completion(maxed: MaxedCard[], rules: RarityRule[], items: CatalogItem[]) {
  const counted = new Map<string, Set<CatalogItem>>(rules.map((r) => [r.id, new Set()]));
  const unlisted: MaxedCard[] = [];
  for (const m of maxed) {
    const rule = rules.find((r) => r.id === m.rarityId);
    const item = rule && findInCatalog({ id: '', name: m.name, rarityId: m.rarityId, fusion: 0, guest: false }, rule, items);
    if (item && appRarityId(item, rules) === m.rarityId) counted.get(m.rarityId)!.add(item);
    else unlisted.push(m);
  }
  const totals = new Map<string, number>();
  for (const i of items) {
    const id = appRarityId(i, rules);
    if (id) totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  const rarities: RarityCompletion[] = rules
    .filter((r) => totals.has(r.id))
    .map((r) => ({ rarityId: r.id, maxed: counted.get(r.id)!.size, total: totals.get(r.id)! }));
  return { rarities, unlisted };
}

/** A card has no art yet, or art from an older wiki lookup that MK Mobile Base may have a proper card image for. */
export const wantsCatalogImage = (card: Card) => !card.imageUrl || (!!card.wikiTitle && !card.imagePage);

/** Catalog art for each card that wants it and is in the catalog; images pasted by hand are never touched. */
export function catalogImageUpdates(cards: Card[], rules: Map<string, RarityRule>, items: CatalogItem[]) {
  const out = new Map<string, Pick<Card, 'imageUrl' | 'imagePage' | 'wikiTitle'>>();
  for (const c of cards) {
    if (!wantsCatalogImage(c)) continue;
    const hit = findInCatalog(c, rules.get(c.rarityId), items);
    if (hit) out.set(c.id, { imageUrl: hit.image, imagePage: catalogPageUrl(hit), wikiTitle: undefined });
  }
  return out;
}

/**
 * Cards whose rarity MK Mobile Base gives differently, with the app rarity it gives. Only rarities of the card's own
 * kind count, so a Kameo is never moved to a character rarity. A rarity the user chose to keep isn't offered again,
 * unless the site later gives yet another one.
 */
export function rarityMismatches(cards: Card[], rules: Map<string, RarityRule>, items: CatalogItem[]) {
  return cards.flatMap((card) => {
    const hit = findInCatalog(card, rules.get(card.rarityId), items);
    const to = hit && appRarityId(hit, rules.values());
    return to && to !== card.rarityId && to !== card.keptRarity ? [{ card, to }] : [];
  });
}
