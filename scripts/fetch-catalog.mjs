// Downloads the MK Mobile Base (mkmobilebase.com) character, equipment and Kameo catalog into public/catalog.json:
// each item's name, kind, rarity and thumbnail URLs, plus what the Klash Tower planner scores teams with (team, class,
// stats, gear slot and set, effect tags, community score, best-team partners, and each character's Team Passive from
// the MK Mobile wiki). The site's API doesn't allow cross-site requests, so the app can't call it directly; it reads
// this file instead. Run by the deploy workflow, or: npm run catalog
import { readFileSync, writeFileSync } from 'node:fs';
import { nameKey } from '../src/names.ts';

const SITE = 'https://mkmobilebase.com/api';
const API = `${SITE}/categories`;
const WIKI = 'https://mortalkombat-mobile.fandom.com/api.php';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mkmax catalog (https://github.com/Simba3696/mkmax)' };
const RARITIES = ['diamond', 'gold', 'silver', 'bronze', 'epic', 'rare', 'uncommon', 'common', 'legendary'];
/** The rarities a Klash Tower pool deals; only these need tower data, so only these are checked and refreshed. */
const TOWER = { character: ['gold', 'diamond'], kameo: ['gold', 'diamond'], equipment: ['rare', 'epic'] };
const inTower = (c) => TOWER[c.kind]?.includes(c.rarity) ?? false;
/** Far past any real category (4 pages of 100 at most today), so a page count that never ends fails instead. */
const MAX_PAGES = 50;
/** More than a tenth of a group and more than 3, so the site fixing a card or two in a small group doesn't fail every
 * deploy. */
const tooMany = (n, of) => n > Math.max(3, of / 10);
/** The deployed app; the deploy workflow sets PAGES_URL. */
const LIVE = `${process.env.PAGES_URL ?? 'https://simba3696.github.io/mkmax'}/catalog.json`;
const FILE = new URL('../public/catalog.json', import.meta.url);
/** How long one request may take before it fails. */
const REQUEST_MS = 30_000;
// The whole download takes seconds. Pages that each answer just inside REQUEST_MS could otherwise add up past the
// build job's 15 minutes, which would end the job before it falls back to the live copy.
const DEADLINE_MINUTES = 5;
const DEADLINE = Date.now() + DEADLINE_MINUTES * 60_000;
// Best-team partners take one request per character, so a run asks about at most this many (cards never asked about
// first, then the longest ago), 4 at a time, and starts none in the last minute before the deadline: the first run,
// with no earlier copy to carry partners from, would otherwise ask about every character and could run out of time.
// The rest keep the earlier copy's partners and go first next time.
const ARTICLES_PER_RUN = 80;
const ARTICLES_AT_ONCE = 4;
const ARTICLES_STOP_MS = 60_000;
/** The wiki's API answers at most 50 pages a request. */
const WIKI_BATCH = 50;

async function getJson(url) {
  // Every request has the same time limit as the catalog pages, so a stall fails or skips it instead of holding the
  // deploy until the job's limit.
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(category) {
  const items = [];
  let pages;
  for (let page = 1; ; page++) {
    if (Date.now() > DEADLINE) {
      throw new Error(`${category} page ${page}: still downloading after ${DEADLINE_MINUTES} minutes`);
    }
    // A stalled download fails after REQUEST_MS, so the deploy goes on with the live copy instead of waiting.
    const res = await fetch(`${API}/${category}/articles?per_page=100&page=${page}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (!res.ok) throw new Error(`${category} page ${page}: HTTP ${res.status}`);
    const { data, meta } = await res.json();
    // Without a usable page count the loop would stop early (and ship part of the catalog) or keep asking for pages
    // until the deadline, so this fails it at once and the deploy keeps the live copy instead.
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
      // When the site sends an item count, the items read must match it, so pages that end before the site's own count
      // (a page count that's too low, or short pages) fail here.
      if (Number.isInteger(meta.total) && items.length !== meta.total) {
        throw new Error(`${category}: got ${items.length} items, the site says ${meta.total}`);
      }
      return items;
    }
  }
}

const plain = (html) => (typeof html === 'string' ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

/** Rarity from the item's tags (e.g. "Diamond", "rare"), falling back to the excerpt ("Rare"). */
function rarityOf(item) {
  const fromTags = item.tags?.map((t) => t.slug?.toLowerCase()).find((s) => RARITIES.includes(s));
  if (fromTags) return fromTags;
  const text = plain(item.excerpt).toLowerCase();
  return RARITIES.find((r) => new RegExp(`\\b${r}\\b`).test(text)) ?? null;
}

/** The site's tags in lower case (effects like "snare", teams, classes, gear slots), less rarities and "kameo". */
function tagsOf(item) {
  const names = (item.tags ?? []).map((t) => (typeof t?.name === 'string' ? t.name.trim().toLowerCase() : ''));
  return [...new Set(names.filter((n) => n && n !== 'kameo' && !RARITIES.includes(n)))].sort();
}

/** A character's or Kameo's classes from its excerpt ("Elder God, Netherrealm"); gear's excerpt is its rarity. */
function classesOf(item) {
  return plain(item.excerpt)
    .split(/\s*[,/]\s*/)
    .filter((c) => c && !RARITIES.includes(c.toLowerCase()));
}

// Art is saved on cards and synced, so only an https link counts; anything else (an object, an http: or data: link)
// counts as missing art for the checks below.
const httpsLink = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : undefined);
const catalog = [];
for (const [category, kind] of [['characters', 'character'], ['equipment', 'equipment'], ['kameos', 'kameo']]) {
  const items = await fetchAll(category);
  // An empty category means the API has changed; failing keeps the deployed catalog rather than shipping one
  // without card art or rarities.
  if (!items.length) throw new Error(`${category}: no items`);
  // Kameo titles read "Baraka - Klassic Kameo"; drop the suffix so names match cards like "Baraka, Klassic".
  // The name is read after that, so a Kameo titled just "Kameo" counts as having none.
  const nameOf = (item) => {
    const title = typeof item.title === 'string' ? item.title : '';
    return kind === 'kameo' ? title.replace(/\s*Kameo$/i, '') : title;
  };
  // The app needs a card's name, and links it to its MK Mobile Base page by slug, which the repeat check below also
  // tells items apart by. An item without either is one the site hasn't finished: it's left out and the rest still
  // ship. Many of them (more than a tenth and more than 3), or none left, means the API has changed, so that fails.
  const usable = items.filter((i) => typeof i.slug === 'string' && i.slug && nameOf(i).trim());
  const skipped = items.length - usable.length;
  if (!usable.length || tooMany(skipped, items.length)) {
    throw new Error(`${category}: ${skipped} of ${items.length} items have no slug or name`);
  }
  if (skipped) console.warn(`${category}: left out ${skipped} unfinished item(s) with no slug or name`);
  // A site that ignored the page asked for would send page 1 again and again; when it sends no item count, or the count
  // exactly fills every page, no other check here notices.
  if (new Set(usable.map((i) => i.slug)).size !== usable.length) {
    throw new Error(`${category}: the same item came back twice`);
  }
  for (const item of usable) {
    const image = httpsLink(item.image_thumb_2x_url) ?? httpsLink(item.image_url);
    const card = { kind, name: nameOf(item), rarity: rarityOf(item), slug: item.slug, image };
    const tags = tagsOf(item);
    if (tags.length) card.tags = tags;
    const classes = kind === 'equipment' ? [] : classesOf(item);
    if (classes.length) card.class = classes;
    catalog.push(card);
  }
}
// Every card has art and a rarity today, so many without means the API renamed those fields; failing keeps the deployed
// catalog rather than shipping cards without them. A tenth of the whole catalog catches a kind losing them; art is also
// counted per kind and rarity (more than a tenth and more than 3), so a small group can't hide in the whole catalog.
// A new card or two the site hasn't finished (no art or rarity yet) fails neither, and cards with no rarity yet aren't
// a group of their own there: they're all new, so a game update's worth would fail every deploy until the site
// finishes them, and the tenth of the whole catalog already limits them.
for (const key of ['image', 'rarity']) {
  const missing = catalog.filter((c) => !c[key]).length;
  if (missing > catalog.length / 10) throw new Error(`catalog: ${missing} of ${catalog.length} items have no ${key}`);
}
for (const [group, cards] of Map.groupBy(catalog.filter((c) => c.rarity), (c) => `${c.kind} ${c.rarity}`)) {
  const missing = cards.filter((c) => !c.image).length;
  if (tooMany(missing, cards.length)) {
    throw new Error(`catalog: ${missing} of ${cards.length} ${group} cards have no image`);
  }
}

// Klash Tower data from MK Mobile Base. Its lists share no ids with the catalog (gear is "royal_e_h" in one and
// "royalguards_emerald_haze" in another), so cards are matched by name, the same way the app matches them. The squad
// builder's own rarity says "diamond" for every character, so rarity keeps coming from the catalog's tags above. Its
// field names (type, finisherType, characterCodes) are turned into the catalog's own (slot, set, setFor) here, so the
// app never sees them. A failure here fails the whole refresh, like the catalog pages: it's the same site.
const en = (v) => (typeof v === 'string' ? v : typeof v?.en === 'string' ? v.en : '');
const positive = (v) => {
  const n = Number(en(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const byName = new Map(catalog.map((c) => [`${c.kind} ${nameKey(c.name)}`, c]));
const find = (kind, name) => (name.trim() ? byName.get(`${kind} ${nameKey(name)}`) : undefined);

const squad = await getJson(`${SITE}/squad-builder-options`).catch((e) => {
  throw new Error(`squad-builder-options: ${e.message}`);
});
if (!Array.isArray(squad?.characters) || !Array.isArray(squad?.equipment)) {
  throw new Error('squad-builder-options: unexpected data');
}
const characterNames = new Map();
for (const c of squad.characters) {
  const card = find('character', `${en(c?.name)} ${en(c?.team)}`);
  if (!card) continue;
  if (typeof c.code === 'string') characterNames.set(c.code, card.name);
  if (en(c.team)) card.team = en(c.team);
  const attack = positive(c.attack);
  const health = positive(c.health);
  if (attack && health) Object.assign(card, { attack, health });
}
const SLOTS = ['weapon', 'armor', 'accessory'];
for (const g of squad.equipment) {
  const card = find('equipment', en(g?.name));
  if (!card) continue;
  if (SLOTS.includes(g.type)) card.slot = g.type;
  if (['friendship', 'brutality'].includes(g.finisherType)) card.set = g.finisherType;
  const owners = (Array.isArray(g.characterCodes) ? g.characterCodes : []).map((code) => characterNames.get(code));
  if (card.set && owners.some(Boolean)) card.setFor = [...new Set(owners.filter(Boolean))].sort();
}
for (const section of ['characters', 'equipment']) {
  const rated = await getJson(`${SITE}/rating?section=${section}&locale=en`).catch((e) => {
    throw new Error(`rating ${section}: ${e.message}`);
  });
  if (!Array.isArray(rated?.data)) throw new Error(`rating ${section}: unexpected data`);
  const kind = section === 'characters' ? 'character' : 'equipment';
  for (const r of rated.data) {
    const card = find(kind, en(r?.title));
    const votes = Number.isInteger(r?.votes_count) ? r.votes_count : 0;
    if (card && votes > 0 && typeof r.average_score === 'number') {
      Object.assign(card, { score: Math.round(r.average_score * 10) / 10, votes });
    }
  }
}
// Most Gold and Diamond characters and Rare and Epic gear have this data today, so many without means the site renamed
// a field or the names stopped matching; failing keeps the deployed catalog rather than shipping a tower planner that
// can't place gear or score teams. A new card or two the site hasn't added to its squad builder fails neither.
for (const [what, kind, has] of [
  ['characters with no squad data', 'character', (c) => c.team && c.attack],
  ['gear with no slot', 'equipment', (c) => c.slot],
]) {
  const group = catalog.filter((c) => c.kind === kind && inTower(c));
  const missing = group.filter((c) => !has(c)).length;
  if (tooMany(missing, group.length)) throw new Error(`catalog: ${missing} of ${group.length} ${what}`);
}

// A kind and rarity with far fewer cards than the newest earlier copy means the site lost them, not that the game
// removed them, so failing keeps the live catalog. That's the live copy, or the local one (the committed one in CI)
// when it's newer or the live one can't be read. After a real removal, CATALOG_ACCEPT_DROP=1 npm run catalog skips the
// comparison so the fresh catalog.json can be committed, and later deploys compare with that. Cards without a rarity
// aren't counted, so fewer of those never fails. The same copy carries the best-team partners and wiki passives
// forward for cards this run doesn't refresh.
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
  const live = await copy(() => getJson(LIVE), 'live');
  const local = await copy(() => JSON.parse(readFileSync(FILE, 'utf8')), 'local');
  // A copy without a date counts as the oldest, not (as "undefined") the newest.
  const date = (c) => (typeof c.fetchedAt === 'string' ? c.fetchedAt : '');
  return [live, local].filter(Boolean).sort((a, b) => date(b).localeCompare(date(a)))[0];
}
const earlier = await earlierCopy();
const earlierCard = new Map(
  (earlier?.items ?? []).filter((i) => typeof i.name === 'string').map((i) => [`${i.kind} ${nameKey(i.name)}`, i]),
);
const before = (c) => earlierCard.get(`${c.kind} ${nameKey(c.name)}`);
const towerCharacters = catalog.filter((c) => c.kind === 'character' && inTower(c));
const names = (list) => (Array.isArray(list) ? list.filter((n) => typeof n === 'string') : []);
for (const c of towerCharacters) {
  const was = before(c);
  if (typeof was?.teamsAt === 'string') c.teamsAt = was.teamsAt;
  if (names(was?.bestTeams).length) c.bestTeams = names(was.bestTeams);
}
// Expected on the first run with tower data; on a later one it means the live copy couldn't be read and the older
// committed copy stood in, so partners and passives the wiki doesn't give this run are missing until later runs.
if (towerCharacters.length && !towerCharacters.some((c) => before(c)?.teamsAt || before(c)?.passive)) {
  console.warn("klash: the earlier copy has no Klash Tower data, so best teams and Team Passives fill in over the next runs");
}
/** Far fewer than the same characters had before: a page layout change, not real edits, so the earlier copy's stay. */
const collapsed = (found, had, floor) => found < had / 2 && had - found > floor;

// Best-team partners: the characters each character's MK Mobile Base guide names under "Best teams".
const characterBySlug = new Map(catalog.filter((c) => c.kind === 'character').map((c) => [c.slug, c.name]));
function bestTeamsOf(article, self) {
  const section = article?.data?.editorial_guide?.sections?.find?.((s) => s?.key === 'best_teams');
  const html = typeof section?.html === 'string' ? section.html : typeof section?.text === 'string' ? section.text : '';
  const linked = [...html.matchAll(/category\/characters\/([a-z0-9_-]+)/g)].map((m) => characterBySlug.get(m[1]));
  return [...new Set(linked.filter((n) => n && n !== self))].sort();
}
const queue = towerCharacters
  .toSorted((a, b) => (a.teamsAt ?? '').localeCompare(b.teamsAt ?? '') || a.name.localeCompare(b.name))
  .slice(0, ARTICLES_PER_RUN);
const today = new Date(Date.now()).toISOString().slice(0, 10);
let next = 0;
let tried = 0;
let failed = 0;
const answers = new Map();
async function articleWorker() {
  while (next < queue.length && Date.now() < DEADLINE - ARTICLES_STOP_MS) {
    const c = queue[next++];
    tried++;
    try {
      answers.set(c, bestTeamsOf(await getJson(`${SITE}/articles/${encodeURIComponent(c.slug)}`), c.name));
    } catch (e) {
      // One card's guide failing keeps its earlier partners; it's asked about again first next run.
      failed++;
      console.warn(`articles: ${c.slug}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: ARTICLES_AT_ONCE }, articleWorker));
// Every guide failing means the site changed how they're served, not a card or two failing.
if (tried >= ARTICLES_AT_ONCE && failed === tried) throw new Error(`articles: all ${tried} requests failed`);
if (next < queue.length) console.warn(`articles: stopped before the deadline with ${queue.length - next} left for next time`);
// Guides that still answer but name far fewer partners than the same characters had (the page layout changed) would
// wipe every character's partners over a few runs, so those characters keep theirs and are asked again first.
const foundTeams = [...answers.values()].filter((p) => p.length).length;
const hadTeams = [...answers.keys()].filter((c) => c.bestTeams).length;
if (collapsed(foundTeams, hadTeams, 3)) {
  console.warn(`articles: read best teams for ${foundTeams} characters, down from ${hadTeams}; keeping the earlier copy's`);
} else {
  for (const [c, partners] of answers) {
    if (partners.length) c.bestTeams = partners;
    else delete c.bestTeams;
    c.teamsAt = today;
  }
}

// Team Passives and "Good With" partners from the MK Mobile wiki, a different site: when it fails, or answers with far
// fewer Team Passives or Good With lists than the earlier copy had (a page template change can do that while it still
// answers), every character keeps the earlier copy's instead, and the catalog still refreshes. A character whose page
// wasn't read this time (renamed, out of its category, or sent without its text) keeps its own. Passives rarely change.
const wikiUrl = (params) => {
  const u = new URL(WIKI);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) u.searchParams.set(k, v);
  return u.href;
};
const linkText = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
const cellText = (line) => line.replace(/^\s*\|/, '').split('|').pop().trim();
function teamPassiveOf(text) {
  // Each ability is a table row: its name, its classification ("Team Passive"), then its description, which may run
  // on over more lines until the next cell.
  const lines = linkText(text).split('\n');
  const at = lines.findIndex((l) => /^\s*\|/.test(l) && cellText(l).toLowerCase() === 'team passive');
  if (at < 0) return undefined;
  const parts = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*[|!]/.test(line)) {
      if (parts.length) break;
      parts.push(cellText(line));
    } else if (parts.length) parts.push(line.trim());
  }
  const passive = plain(parts.join(' ').replace(/\{\{[^}]*\}\}/g, '').replace(/'{2,}/g, ''));
  return passive ? passive.slice(0, 500) : undefined;
}
function goodWithOf(text) {
  const start = text.search(/=+\s*Good With\s*=+/i);
  if (start < 0) return [];
  const rest = text.slice(start).replace(/^=+[^=\n]*=+/, '');
  const end = rest.search(/\n=+/);
  const section = end < 0 ? rest : rest.slice(0, end);
  const titles = [...section.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).filter((t) => t.includes('/') && !/^(:|Category:|File:|Equipment)/i.test(t));
  return [...new Set(titles.map((t) => find('character', t.replace('/', ' '))?.name).filter(Boolean))].sort();
}
async function wikiPages() {
  const titles = [];
  for (const category of ['Category:Diamond Characters', 'Category:Gold Characters']) {
    let more = {};
    for (let page = 0; page < MAX_PAGES; page++) {
      if (Date.now() > DEADLINE - ARTICLES_STOP_MS) throw new Error('out of time');
      const j = await getJson(wikiUrl({ action: 'query', list: 'categorymembers', cmtitle: category, cmlimit: '500', cmnamespace: '0', ...more }));
      if (!Array.isArray(j?.query?.categorymembers)) throw new Error(`${category}: unexpected data`);
      titles.push(...j.query.categorymembers.map((m) => m?.title).filter((t) => typeof t === 'string'));
      if (!j.continue) break;
      more = j.continue;
    }
  }
  const pages = new Map();
  for (let i = 0; i < titles.length; i += WIKI_BATCH) {
    if (Date.now() > DEADLINE - ARTICLES_STOP_MS) throw new Error('out of time');
    const j = await getJson(wikiUrl({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + WIKI_BATCH).join('|') }));
    if (!Array.isArray(j?.query?.pages)) throw new Error('unexpected page data');
    for (const p of j.query.pages) {
      const text = p?.revisions?.[0]?.slots?.main?.content;
      const card = typeof p?.title === 'string' ? find('character', p.title.replace('/', ' ')) : undefined;
      if (card && typeof text === 'string') pages.set(card, text);
    }
  }
  return pages;
}
const WIKI_FIELDS = { passive: 'Team Passives', goodWith: 'Good With lists' };
const earlierWiki = (c) => {
  const was = before(c);
  return { passive: typeof was?.passive === 'string' ? was.passive : undefined, goodWith: names(was?.goodWith) };
};
const has = (value) => (Array.isArray(value) ? value.length > 0 : !!value);
const keepEarlier = (c, field) => {
  const was = earlierWiki(c)[field];
  if (has(was)) c[field] = was;
};
try {
  const pages = await wikiPages();
  const read = new Map(
    [...pages].map(([c, text]) => [c, { passive: teamPassiveOf(text), goodWith: goodWithOf(text).filter((n) => n !== c.name) }]),
  );
  // Only the pages read this time are compared, so pages the wiki left out don't count as passives lost.
  const readTower = towerCharacters.filter((c) => read.has(c));
  for (const [field, label] of Object.entries(WIKI_FIELDS)) {
    const found = readTower.filter((c) => has(read.get(c)[field])).length;
    const had = readTower.filter((c) => has(earlierWiki(c)[field])).length;
    const keep = collapsed(found, had, 10);
    if (keep) console.warn(`wiki: read ${found} ${label}, down from ${had}; keeping the earlier copy's`);
    for (const c of towerCharacters) {
      if (keep || !read.has(c)) keepEarlier(c, field);
      else if (has(read.get(c)[field])) c[field] = read.get(c)[field];
    }
  }
} catch (e) {
  console.warn(`wiki: ${e.message}; keeping the earlier copy's Team Passives`);
  for (const c of towerCharacters) for (const field of Object.keys(WIKI_FIELDS)) keepEarlier(c, field);
}

if (earlier && process.env.CATALOG_ACCEPT_DROP !== '1') {
  const byKindAndRarity = (items) => {
    const counts = new Map();
    for (const { kind, rarity } of items) {
      if (rarity) counts.set(`${kind} ${rarity}`, (counts.get(`${kind} ${rarity}`) ?? 0) + 1);
    }
    return counts;
  };
  const now = byKindAndRarity(catalog);
  for (const [key, was] of byKindAndRarity(earlier.items)) {
    const count = now.get(key) ?? 0;
    if (tooMany(was - count, was)) throw new Error(`catalog: ${count} ${key} cards, down from ${was}`);
  }
}
catalog.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
writeFileSync(FILE, JSON.stringify({ source: 'https://mkmobilebase.com', fetchedAt: new Date().toISOString(), items: catalog }) + '\n');
const count = (k) => catalog.filter((c) => c.kind === k).length;
const tower = (key) => towerCharacters.filter((c) => c[key]).length;
console.log(`catalog: ${count('character')} characters, ${count('equipment')} equipment, ${count('kameo')} kameos, ${catalog.filter((c) => !c.rarity).length} without a rarity`);
console.log(`klash: of ${towerCharacters.length} Gold and Diamond characters, ${tower('passive')} have a Team Passive, ${tower('bestTeams')} best teams, ${tower('goodWith')} Good With`);
