// Finds card art on the MK Mobile fandom wiki (MediaWiki API, anonymous CORS via origin=*).
// Only image URLs are stored; the art itself stays on the wiki's CDN.
import type { Card, RarityRule } from './types';

const API = 'https://mortalkombat-mobile.fandom.com/api.php';
const WIKI = 'https://mortalkombat-mobile.fandom.com/wiki/';
const THUMB = 240;

/** Pages that list gear without giving each item its own page. */
const GEAR_LIST_PAGES = ['Equipment/Epic', 'Equipment/Rare', 'Equipment/Legendary'];

export interface WikiMatch {
  imageUrl: string;
  wikiTitle: string;
}

export const wikiUrl = (title: string) => WIKI + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/');

type Page = { title: string; missing?: string; thumbnail?: { source: string }; imageinfo?: { thumburl?: string; url: string }[] };

async function api(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) throw new Error(`Wiki request failed (${res.status})`);
  return res.json();
}

/** Query up to 50 titles at a time, returning pages keyed by the title that was asked for. */
async function queryTitles(titles: string[], params: Record<string, string>): Promise<Map<string, Page>> {
  const out = new Map<string, Page>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const r = await api({ action: 'query', redirects: '1', titles: batch.join('|'), ...params });
    const back = new Map<string, string>();
    for (const x of [...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])]) back.set(x.to, x.from);
    for (const p of Object.values<Page>(r.query?.pages ?? {})) {
      let t = p.title;
      while (back.has(t)) t = back.get(t)!;
      out.set(t, p);
    }
  }
  return out;
}

/** "Scorpion, MKII Movie" → "Scorpion/MK2 Movie"; the wiki names Kold War variants in full. */
export function characterTitle(name: string) {
  const [base, ...rest] = name.split(',');
  const variant = rest.join(',').trim().replace(/\bMKII\b/g, 'MK2').replace(/^Kold$/, 'Kold War');
  return variant ? `${base.trim()}/${variant}` : base.trim();
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Accept a search hit only if it's the same character and its variant starts with the same words. */
function sameCharacter(name: string, title: string) {
  const [base, ...rest] = name.split(',');
  const [tBase, tVariant] = title.split('/');
  if (!tVariant || tBase.toLowerCase() !== base.trim().toLowerCase()) return false;
  const want = words(rest.join(' ').replace(/\bMKII\b/g, 'MK2'));
  const got = words(tVariant);
  return want.length > 0 && want.every((w, i) => got[i] === w);
}

/**
 * Loose keys for matching gear names to file names ("Takahashi's Gauntlet FX.png", "SmugglerLuck postEvo.png"):
 * one keeps a possessive "s", one drops it, since the wiki's file names do either.
 */
function gearKeys(s: string) {
  const base = s
    .toLowerCase()
    .replace(/^file:/, '')
    .replace(/\.(png|jpe?g|gif|webp)$/, '')
    .replace(/\b(fx|postevo|preevo|full pic|pic)\b/g, '');
  return [base, base.replace(/['’]s\b/g, '')].map((k) => k.replace(/[^a-z0-9]/g, ''));
}

function gearMatches(name: string, file: string) {
  return gearKeys(name).some((a) => gearKeys(file).some((b) => a.length > 3 && b.length > 3 && (a === b || a.startsWith(b) || b.startsWith(a))));
}

/** Look up art for each card; cards with no confident match are left out. */
export async function findCardImages(cards: Card[], rules: Map<string, RarityRule>, onProgress?: (msg: string) => void): Promise<Map<string, WikiMatch>> {
  const found = new Map<string, WikiMatch>();
  const isChar = (c: Card) => rules.get(c.rarityId)?.kind === 'character';
  const titleOf = (c: Card) => (isChar(c) ? characterTitle(c.name) : c.name);
  const thumbParams = { prop: 'pageimages', piprop: 'thumbnail', pithumbsize: String(THUMB) };

  // 1. Direct page lookups.
  onProgress?.('Looking up card pages…');
  const pages = await queryTitles([...new Set(cards.map(titleOf))], thumbParams);
  for (const c of cards) {
    const p = pages.get(titleOf(c));
    if (p && p.missing === undefined && p.thumbnail) found.set(c.id, { imageUrl: p.thumbnail.source, wikiTitle: p.title });
  }

  // 2. Direct lookup missed: search, but only accept the same character + variant, or gear whose
  //    title contains every word of the name (e.g. "Datusha, Bane of the Moroi").
  const hits = new Map<string, string>();
  for (const c of cards.filter((c) => !found.has(c.id))) {
    onProgress?.(`Searching for ${c.name}…`);
    const r = await api({ action: 'query', list: 'search', srlimit: '5', srsearch: c.name.replace(',', ' ') });
    const accept = isChar(c) ? (t: string) => sameCharacter(c.name, t) : (t: string) => !t.includes('/') && words(c.name).every((w) => words(t).includes(w));
    const title = (r.query?.search ?? []).map((s: { title: string }) => s.title).find(accept);
    if (title) hits.set(c.id, title);
  }
  if (hits.size) {
    const hitPages = await queryTitles([...new Set(hits.values())], thumbParams);
    for (const [id, title] of hits) {
      const p = hitPages.get(title);
      if (p?.thumbnail) found.set(id, { imageUrl: p.thumbnail.source, wikiTitle: p.title });
    }
  }

  // 3. Gear without its own page: match against the images on the gear list pages.
  const gear = cards.filter((c) => !isChar(c) && !found.has(c.id));
  if (gear.length) {
    onProgress?.('Checking equipment lists…');
    const lists = await queryTitles(GEAR_LIST_PAGES, { prop: 'images', imlimit: 'max' });
    const files = new Map<string, string>(); // file → list page
    for (const [page, p] of lists) for (const img of (p as Page & { images?: { title: string }[] }).images ?? []) files.set(img.title, page);
    const picks = new Map<string, string>();
    for (const c of gear) {
      const file = [...files.keys()].find((f) => gearMatches(c.name, f));
      if (file) picks.set(c.id, file);
    }
    if (picks.size) {
      const info = await queryTitles([...new Set(picks.values())], { prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(THUMB) });
      for (const [id, file] of picks) {
        const ii = info.get(file)?.imageinfo?.[0];
        if (ii) found.set(id, { imageUrl: ii.thumburl ?? ii.url, wikiTitle: files.get(file)! });
      }
    }
  }
  return found;
}
