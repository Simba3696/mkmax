// Brings saves, imports and synced data up to the current shape. Plain TS (no React) so scripts can use it too.
import type { AppState, Card, RarityRule } from './types';
import { ASCENSION_KARD_COST, ASCENSION_KARD_COSTS, DIAMOND_KARD_COSTS, GEAR_KARD_COSTS, defaultRarities, defaultState, defaultWeights } from './defaults';
import { REALM_KLASH_CURRENCY, pruneDone } from './engine';
import { isChallengeKameo, isRetiredChallenge } from './challenges';
import { fixPackNames } from './events';

/**
 * Version 1 saves counted the first copy as F1; version 2 starts at F0. Shift owned levels up one,
 * reset built-in rarities to the new fusion tables (keeping kard counts), and extend custom ones.
 */
function migrateV1(s: Partial<AppState>): Partial<AppState> {
  const defaults = new Map(defaultState().rarities.map((r) => [r.id, r]));
  return {
    ...s,
    rarities: s.rarities?.map((r) => {
      const d = defaults.get(r.id);
      return d ? { ...d, label: r.label, color: r.color, fusionUpKards: r.fusionUpKards } : { ...r, dupesPerLevel: [...r.dupesPerLevel, 1] };
    }),
    cards: s.cards!.map((c) => {
      const { spare: _spare, ...rest } = c as typeof c & { spare?: number };
      return { ...rest, fusion: c.fusion > 0 ? c.fusion + 1 : 0, maxLevel: c.maxLevel != null ? c.maxLevel + 1 : c.maxLevel };
    }),
  };
}

/** The old rare-equipment color (green) before Rare switched to the game's blue. */
const OLD_RARE_COLOR = '#6fcf97';

/**
 * Realm Klash ("Blood Ruby") gear used to be its own rarity; it's Epic gear that's bought to max, so those
 * cards move to Epic with a per-card goal of max. Priority tiers were dropped (everything gets maxed).
 */
function migrateLegacyFields(s: Partial<AppState>): Partial<AppState> {
  let rarities = s.rarities ?? [];
  let cards = (s.cards ?? []).map((c) => {
    const { tier: _tier, ...rest } = c as Card & { tier?: string };
    return rest as Card;
  });
  if (rarities.some((r) => r.id === 'blood-ruby')) {
    cards = cards.map((c) => (c.rarityId === 'blood-ruby' ? { ...c, rarityId: 'epic', goal: 'max' as const } : c));
    rarities = rarities.filter((r) => r.id !== 'blood-ruby');
    if (!rarities.some((r) => r.id === 'epic')) rarities = [...rarities, defaultRarities().find((r) => r.id === 'epic')!];
  }
  rarities = rarities.map((r): RarityRule => (r.id === 'rare' && r.color === OLD_RARE_COLOR ? { ...r, color: defaultRarities().find((d) => d.id === 'rare')!.color } : r));
  const { tier: _tier, ...weights } = (s.weights ?? {}) as Partial<AppState['weights']> & { tier?: unknown };
  return { ...s, rarities, cards, weights: weights as AppState['weights'] };
}

function migrateKameos(s: Partial<AppState>, version: number): Partial<AppState> {
  const kameoRarities = defaultRarities().filter((r) => r.kind === 'kameo');
  let rarities = s.rarities ?? [];
  const hadSingle = rarities.some((r) => r.id === 'kameo');
  if (!hadSingle && version >= 3) return s; // the user deleted the Kameo rarity; don't bring it back
  rarities = rarities.filter((r) => r.id !== 'kameo');
  for (const r of kameoRarities) if (!rarities.some((x) => x.id === r.id)) rarities = [...rarities, r];
  const cards = (s.cards ?? []).map((c) => (c.rarityId === 'kameo' ? { ...c, rarityId: 'kameo-diamond' } : c));
  return { ...s, rarities, cards };
}

/**
 * Saves from before kard costs existed get the rarity's default table (the Diamond curve). Tables from before
 * kards covered ascension are extended with the default ascension costs, keeping the user's fusion costs.
 */
export function kardTable(r: RarityRule): number[] {
  if (r.fusionUpThreshold == null) return r.kardsPerLevel ?? []; // no kards (Kameos, Uncommon gear)
  const builtIn = defaultRarities().find((x) => x.id === r.id);
  const d = builtIn?.kardsPerLevel ?? [...DIAMOND_KARD_COSTS];
  // Built-in rarities that come with no kards (Uncommon gear, Kameos) start at 0 a step when kards are turned on.
  const pad = builtIn && d.length === 0 ? 0 : ASCENSION_KARD_COST;
  const costs = r.kardsPerLevel?.length ? [...r.kardsPerLevel] : [...d];
  for (let i = costs.length; i < (r.dupesPerLevel?.length ?? 0); i++) costs.push(d[i] ?? pad);
  return costs;
}

/** Card (and same-named pack) names from older saves, mapped to the game's spelling. */
const RENAMED: Record<string, string> = { 'Datusha, Bane of Moroi': 'Datusha, Bane of the Moroi' };

/** Fill in fields missing from older saves or hand-edited imports, then drop cards that are already done. */
export function normalize(input: unknown): AppState {
  let s = input as Partial<AppState>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || !Array.isArray(s.packs)) {
    throw new Error('Not an MK Max save file');
  }
  const version = (s.version as number | undefined) ?? 1;
  if (version < 2) s = migrateV1(s);
  s = migrateLegacyFields(s);
  // Kameos: version 3 added one Kameo rarity, version 4 splits it into Diamond and Gold. Both are added once, so
  // deleting them later sticks. Cards from the single rarity start as Diamond; Find images offers the fix for Gold.
  if (version < 4) s = migrateKameos(s, version);
  // Version 6 adds Uncommon gear, once, so deleting it later sticks.
  if (version < 6 && s.rarities?.length && !s.rarities.some((r) => r.id === 'uncommon')) {
    const rareAt = s.rarities.findIndex((r) => r.id === 'rare');
    const rarities = [...s.rarities];
    rarities.splice(rareAt < 0 ? rarities.length : rareAt + 1, 0, defaultRarities().find((r) => r.id === 'uncommon')!);
    s = { ...s, rarities };
  }
  const base = defaultState();
  const out: AppState = {
    version: 13,
    rarities: s.rarities?.length
      ? s.rarities.map((r) => ({
          ...r,
          // Kameos only track owning one (no fusion steps). The old F1→F0 upgrade, run by an outdated copy of the
          // app on newer data, gave them a step, so owning a Kameo stopped counting as done.
          ...(r.kind === 'kameo' && { dupesPerLevel: [] }),
          fusionMax: r.fusionMax ?? 10,
          goal: r.goal ?? 'max',
          // A rarity with a guest-flagged card has guests, whatever an older save said (Gold used to default to none).
          hasGuests: (r.hasGuests ?? r.id === 'diamond') || (s.cards ?? []).some((c) => c.rarityId === r.id && c.guest),
          kardsPerLevel: kardTable(r),
        }))
      : base.rarities,
    currencies: s.currencies?.length ? s.currencies : base.currencies,
    cards: s.cards!,
    packs: s.packs!,
    weights: { ...defaultWeights, ...s.weights },
    realmKlashSeasonEnd: s.realmKlashSeasonEnd ?? null,
    dismissedShopPacks: s.dismissedShopPacks ?? [],
    gearOrder: s.gearOrder ?? [],
    updatedAt: s.updatedAt,
  };
  // Version 5 tags Gold Kameos of challenge characters (they come from Elder challenges). Done once, so a tag
  // the user removes stays removed.
  if (version < 5) for (const c of out.cards) if (!c.source && isChallengeKameo(c, out.rarities)) c.source = 'challenge';
  // Version 7 untags Kameos whose challenge was retired (Klassic Ermac), since they come from packs now.
  if (version < 7) for (const c of out.cards) if (isRetiredChallenge(c)) delete c.source;
  // Version 9 renames packs added under MK Mobile Base's names ("Bloodfire Kameo Summon Pack" is the Blood & Fire
  // Kameo Pack) and fixes misspelled card names from the OneNote starter data.
  if (version < 9) {
    out.packs = fixPackNames(out.packs).map((p) => (RENAMED[p.name] ? { ...p, name: RENAMED[p.name] } : p));
    for (const c of out.cards) if (RENAMED[c.name]) c.name = RENAMED[c.name];
  }
  // Version 10 fixes packs whose site name has a curly apostrophe, which were saved as "Kollector’S Diamond Kasket",
  // and gives Blood Rubies their daily income (65), once, so clearing it sticks.
  if (version < 10) {
    out.packs = out.packs.map((p) => (/’S\b/.test(p.name) ? { ...p, name: p.name.replace(/’S\b/g, '’s') } : p));
    out.currencies = out.currencies.map((c) => (c.id === REALM_KLASH_CURRENCY && c.perDay === undefined ? { ...c, perDay: 65 } : c));
  }
  // Version 11 drops Time Krystals, which only exist in the console games, once, unless a pack is priced in them or
  // there's a balance or daily income to keep.
  if (version < 11) {
    const used = (id: string) => out.packs.some((p) => p.currencyId === id);
    out.currencies = out.currencies.filter((c) => c.id !== 'time-krystals' || used(c.id) || c.balance > 0 || !!c.perDay);
  }
  // Version 12 swaps in the game's Epic and Rare gear kard costs where the save still has the Diamond copy they
  // used to start from, and turns on guests for Kameos. Done once, so later edits stick.
  if (version < 12) {
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const r of out.rarities) {
      if ((r.id === 'epic' || r.id === 'rare') && same(r.kardsPerLevel, DIAMOND_KARD_COSTS)) r.kardsPerLevel = [...GEAR_KARD_COSTS];
      if (r.id === 'kameo-diamond' || r.id === 'kameo-gold') r.hasGuests = true;
    }
  }
  // Version 13 swaps in the game's Gold ascension kard costs (10, 11, 12, 13, 15, 22, 24, 26, 28, 30) where the save
  // still has the flat 10 a step they started as. Done once, so later edits stick.
  if (version < 13) {
    const gold = out.rarities.find((r) => r.id === 'gold');
    const ascension = gold?.kardsPerLevel.slice(10) ?? [];
    if (gold && ascension.length > 0 && ascension.every((k) => k === ASCENSION_KARD_COST)) {
      gold.kardsPerLevel = [...gold.kardsPerLevel.slice(0, 10), ...ascension.map((_, i) => ASCENSION_KARD_COSTS[i] ?? ASCENSION_KARD_COST)];
    }
  }
  pruneDone(out);
  return out;
}
