// Brings saves, imports and synced data up to the current shape. Plain TS (no React) so scripts can use it too.
import type { AppState, Card, RarityRule } from './types';
import { DIAMOND_KARD_COSTS, defaultRarities, defaultState, defaultWeights } from './defaults';
import { pruneDone } from './engine';

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

/** Fill in fields missing from older saves or hand-edited imports, then drop cards that are already done. */
export function normalize(input: unknown): AppState {
  let s = input as Partial<AppState>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || !Array.isArray(s.packs)) {
    throw new Error('Not an MK Max save file');
  }
  const version = (s.version as number | undefined) ?? 1;
  if (version < 2) s = migrateV1(s);
  s = migrateLegacyFields(s);
  // Version 3 added the Kameo rarity; add it once, so deleting it later sticks.
  if (version < 3 && !s.rarities?.some((r) => r.id === 'kameo')) s = { ...s, rarities: [...(s.rarities ?? []), defaultRarities().find((r) => r.id === 'kameo')!] };
  const base = defaultState();
  const out: AppState = {
    version: 3,
    rarities: s.rarities?.length
      ? s.rarities.map((r) => ({
          ...r,
          fusionMax: r.fusionMax ?? 10,
          goal: r.goal ?? 'max',
          // A rarity with a guest-flagged card has guests, whatever an older save said (Gold used to default to none).
          hasGuests: (r.hasGuests ?? r.id === 'diamond') || (s.cards ?? []).some((c) => c.rarityId === r.id && c.guest),
          // Saves from before kard costs existed get the rarity's default table (the Diamond curve).
          kardsPerLevel: r.kardsPerLevel?.length ? r.kardsPerLevel : (defaultRarities().find((d) => d.id === r.id)?.kardsPerLevel ?? [...DIAMOND_KARD_COSTS]),
        }))
      : base.rarities,
    currencies: s.currencies?.length ? s.currencies : base.currencies,
    cards: s.cards!,
    packs: s.packs!,
    towers: s.towers ?? [],
    weights: { ...defaultWeights, ...s.weights },
    updatedAt: s.updatedAt,
  };
  pruneDone(out);
  return out;
}
