// MK Mobile Base's event schedule (bundled as public/events.json by scripts/fetch-events.mjs): shop packs,
// challenges and Realm Klash seasons. Pack drop rates aren't in it; the user still enters those.
import { useEffect, useState } from 'react';
import { nameKey } from './catalog';
import { REALM_KLASH_CURRENCY, toLocalInput } from './engine';
import type { AppState, Card, Pack } from './types';

export interface ShopPack {
  name: string;
  /** ISO times; null = permanent. */
  start: string | null;
  end: string | null;
  cost: number | null;
  /** As the site writes it: "Dragon Krystals", "Blood Ruby", "Soul". */
  currency: string | null;
  /** Purchases allowed; null = unlimited. */
  limit: number | null;
  image: string | null;
}

export interface TimedEvent {
  name: string;
  start: string | null;
  end: string | null;
}

export interface EventSchedule {
  fetchedAt: string;
  /** When the site last captured the schedule from mkmobileevent.com. */
  capturedAt: string | null;
  packs: ShopPack[];
  challenges: TimedEvent[];
  seasons: TimedEvent[];
}

let loaded: Promise<EventSchedule> | null = null;
let current: EventSchedule | null = null;
let fetchedAt = 0;
const listeners = new Set<(e: EventSchedule) => void>();

/** The schedule, fetched once and shared; refreshEvents() fetches it again. */
export function loadEvents(): Promise<EventSchedule> {
  loaded ??= fetch(`${import.meta.env.BASE_URL}events.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`events.json: HTTP ${r.status}`);
      return r.json() as Promise<EventSchedule>;
    })
    .then((e) => {
      current = e;
      fetchedAt = Date.now();
      listeners.forEach((l) => l(e));
      return e;
    })
    .catch((e) => {
      loaded = null;
      throw e;
    });
  return loaded;
}

/**
 * Fetch the schedule again (pull to refresh), keeping the current copy if that fails. The deploy refreshes it
 * daily, so an app left open for days would otherwise keep an old copy.
 */
export function refreshEvents(): Promise<unknown> {
  loaded = null;
  return loadEvents().catch(() => {});
}

// Coming back to the app after an hour or more also picks up a newer schedule.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && fetchedAt && Date.now() - fetchedAt > 60 * 60 * 1000) void refreshEvents();
  });
}

/** The bundled schedule, or null until it loads (or if it isn't there). Updates when it's fetched again. */
export function useEvents() {
  const [events, setEvents] = useState<EventSchedule | null>(current);
  useEffect(() => {
    listeners.add(setEvents);
    loadEvents().then(setEvents, () => {});
    return () => void listeners.delete(setEvents);
  }, []);
  return events;
}

const localOrNull = (iso: string | null) => (iso ? toLocalInput(new Date(iso)) : null);
const endsAfter = (e: { end: string | null }, now: Date) => !e.end || new Date(e.end) > now;

// ---------- Shop packs ----------

/** The app currency a site price is in ("Blood Ruby" → blood-rubies, "Soul" → souls), matched by name. */
export function currencyFor(site: string | null, currencies: AppState['currencies']) {
  if (!site) return undefined;
  const singular = (name: string) =>
    nameKey(name)
      .split(' ')
      .map((w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.replace(/s$/, '')))
      .join(' ');
  return currencies.find((c) => singular(c.name) === singular(site))?.id;
}

/** "MK11 FROST SUMMON PACK" → "MK11 Frost Summon Pack": title case, keeping words with digits as they are. */
export function titleCase(name: string) {
  return name.toLowerCase().replace(/[a-z0-9']+/g, (w) => (/\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
}

/** Packs MK Mobile Base misspells, keyed by the site's name, mapped to the game's name. */
const SITE_PACK_NAMES: Record<string, string> = {
  'BLOODFIRE KAMEO SUMMON PACK': 'Blood & Fire Kameo Pack',
  'POWERPLAY KAMEO SUMMON PACK': 'Power Play Kameo Pack',
};

/** The site calls Kameo packs "… Kameo Summon Pack"; the game calls them "… Kameo Pack". */
const KAMEO_SUMMON = /\bkameo summon pack\b/i;

/** A site pack name as the game writes it: the known fixes above, otherwise title case without "Summon" for Kameo packs. */
export function packName(site: string) {
  return SITE_PACK_NAMES[site.toUpperCase()] ?? titleCase(site).replace(KAMEO_SUMMON, 'Kameo Pack');
}

/** Saved packs named the site's way (added before the fix), renamed to the game's name. */
export function fixPackNames(packs: Pack[]) {
  return packs.map((p) => (SITE_PACK_NAMES[p.name.toUpperCase()] || KAMEO_SUMMON.test(p.name) ? { ...p, name: packName(p.name) } : p));
}

/** Shop packs still on sale or coming up that aren't already in the app (by name) or dismissed. */
export function shopSuggestions(events: EventSchedule, state: AppState, now: Date) {
  const have = new Set([...state.packs.map((p) => p.name), ...(state.dismissedShopPacks ?? [])].map(nameKey));
  return events.packs.filter((p) => endsAfter(p, now) && !have.has(nameKey(p.name)) && !have.has(nameKey(packName(p.name))));
}

/**
 * A new pack filled in from the site: everything but the drop rates. A permanent Blood Ruby pack (like the
 * Kameo summon packs) doesn't leave with the Realm Klash season.
 */
export function packFromShop(shop: ShopPack, state: AppState, id: string): Pack {
  const currencyId = currencyFor(shop.currency, state.currencies) ?? state.currencies[0]?.id ?? '';
  return {
    id,
    name: packName(shop.name),
    currencyId,
    ...(currencyId === REALM_KLASH_CURRENCY && !shop.end && { season: false }),
    cost: shop.cost ?? 0,
    rolls: 1,
    maxPurchases: shop.limit,
    purchased: 0,
    startsAt: localOrNull(shop.start),
    endsAt: localOrNull(shop.end),
    drops: [],
  };
}

// ---------- Challenges ----------

/** The current or next challenge for this card's character, if the schedule lists one. */
export function challengeFor(card: Pick<Card, 'name'>, events: EventSchedule | null, now: Date) {
  const key = nameKey(card.name);
  return events?.challenges.filter((c) => endsAfter(c, now) && nameKey(c.name) === key).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))[0];
}

/** "on now, until Sep 30" or "Sep 30 – Oct 7", in local time. */
export function challengeWhen(ch: TimedEvent, now: Date) {
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (ch.start && new Date(ch.start) > now) return `${day(ch.start)} – ${ch.end ? day(ch.end) : '?'}`;
  return ch.end ? `on now, until ${day(ch.end)}` : 'on now';
}

// ---------- Realm Klash seasons ----------

/**
 * The current season's end from the schedule. The site lists seasons a week at a time ("Circle of Shadow 2",
 * then "Kold" twice), so back-to-back weeks with the same name (ignoring a trailing week number) are one season.
 * Null if the schedule doesn't cover now.
 */
export function scheduledSeasonEnd(events: EventSchedule | null, now: Date): string | null {
  const weeks = (events?.seasons ?? []).filter((s) => s.start && s.end).sort((a, b) => a.start!.localeCompare(b.start!));
  const base = (n: string) => n.replace(/\s+\d+$/, '').toLowerCase();
  const i = weeks.findIndex((w) => new Date(w.start!) <= now && new Date(w.end!) > now);
  if (i < 0) return null;
  let end = weeks[i].end!;
  for (let j = i + 1; j < weeks.length && weeks[j].start === end && base(weeks[j].name) === base(weeks[i].name); j++) end = weeks[j].end!;
  return localOrNull(end);
}
