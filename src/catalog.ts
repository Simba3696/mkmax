// Card catalog from MK Mobile Base (mkmobilebase.com): names, rarities and card art for every character, Kameo and
// piece of equipment. scripts/fetch-catalog.mjs downloads it into public/catalog.json at deploy time, because
// the site's API doesn't allow requests from other sites.
import { useSyncExternalStore } from 'react';
import { nameKey } from './names';
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

/**
 * The catalog in use (the newest download: a first download landing after a fetch-again doesn't replace it), and its
 * text, so a download of the same file changes nothing.
 */
let good: CatalogItem[] | null = null;
let goodText = '';
/** The first download while there's no catalog yet. */
let loading: Promise<CatalogItem[]> | null = null;
let refreshing: Promise<unknown> | null = null;
/** When the last download that worked finished. */
let fetchedAt = 0;
/** Whether any download has been tried, so coming back fetches nothing the app hasn't needed yet. */
let tried = false;
/** Whether a download has failed, so whatever gave up on the catalog then hears when one first works. */
let failed = false;
/**
 * Bumped each time a fetch-again brings a catalog that differs from the copy here, and when the first one that works
 * comes after a failed download (not on a first download that just works: everything waiting on it gets it anyway).
 */
let version = 0;
const listeners = new Set<() => void>();
const bump = () => (version++, listeners.forEach((l) => l()));
/**
 * A connection that hangs rather than fails gives up after this, so Find images doesn't wait for good and a hung
 * fetch-again doesn't hold up the next pull or return.
 */
const DOWNLOAD_TIMEOUT_MS = 30 * 1000;
/** The daily deploy refreshes the catalog; coming back to an app whose copy is older than this fetches it again. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

/**
 * Downloads the catalog. A fetch-again goes past the browser's own copy, which may be from before the daily deploy; the
 * first download may use a recent one, like any other file. It isn't kept for offline use. Only a fetch-again may
 * replace a copy already here: a first download that lands after a pull's is older.
 */
function download(replace: boolean): Promise<CatalogItem[]> {
  tried = true;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error(`MK Mobile Base's card list didn’t download within ${DOWNLOAD_TIMEOUT_MS / 1000} seconds. Check your connection.`)), DOWNLOAD_TIMEOUT_MS);
  return fetch(`${import.meta.env.BASE_URL}catalog.json`, replace ? { cache: 'no-cache', signal: abort.signal } : { signal: abort.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`catalog.json: HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      if (good && (!replace || text === goodText)) return good;
      const changed = good || failed;
      good = (JSON.parse(text) as { items: CatalogItem[] }).items;
      goodText = text;
      if (changed) bump();
      return good;
    })
    // Only once it's in: a page that isn't the catalog (a wifi sign-in page) doesn't count as a fresh copy.
    .then(
      (items) => ((fetchedAt = Date.now()), items),
      (e) => {
        failed = true;
        throw e;
      },
    )
    .finally(() => clearTimeout(timer));
}

/** The catalog: the copy already downloaded if there is one (even while it's being fetched again), else a download. */
export function loadCatalog(): Promise<CatalogItem[]> {
  if (good) return Promise.resolve(good);
  if (!loading) {
    loading = download(false).catch((e) => {
      loading = null; // let the next attempt retry
      // A pull's own download may have brought a copy in meanwhile.
      if (good) return good;
      throw e;
    });
  }
  return loading;
}

/**
 * Fetch the catalog again (pull to refresh, or coming back after an hour, or when no download has worked yet), keeping the
 * current copy if that fails. The daily deploy refreshes it with new cards and art, and nothing else reloads it while the app
 * stays open.
 */
export function refreshCatalog(): Promise<unknown> {
  // With no copy yet and the first download already out (a pull while the app is still starting), that one will do.
  refreshing ??= (!good && loading ? loading : download(true)).catch(() => {}).finally(() => void (refreshing = null));
  return refreshing;
}

/**
 * Changes each time a fetched-again catalog differs from the copy here, or the first that works comes after a failed
 * download; an effect that uses the catalog can list it to run again.
 */
export function useCatalogVersion() {
  return useSyncExternalStore(subscribe, getVersion);
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const getVersion = () => version;

if (typeof document !== 'undefined') {
  // Also when no download has worked yet (offline at launch); a fetch-again that failed is tried again once the copy it
  // kept is an hour old. A restore that sends two events still starts one download (refreshCatalog shares the one out).
  const refreshIfOld = () => {
    if (document.visibilityState !== 'visible' || !tried) return;
    const age = Date.now() - fetchedAt;
    // A download time later than now means the device clock went back: that counts as old too.
    if (fetchedAt && age >= 0 && age <= REFRESH_AFTER_MS) return;
    void refreshCatalog();
  };
  document.addEventListener('visibilitychange', refreshIfOld);
  window.addEventListener('pageshow', (e) => e.persisted && refreshIfOld());
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
