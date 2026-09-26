import type { AppState, RarityRule, Weights } from './types';

const ones = (n: number) => Array(n).fill(1);

export const defaultWeights: Weights = {
  tier: { must: 3, want: 2, nice: 1, skip: 0 },
  unlock: 1.3,
  belowThreshold: 1.5,
  coveredByKards: 0.3,
  guest: 1.5,
  closenessBonus: 0.5,
  limitedBoost: 1.25,
};

export function defaultRarities(): RarityRule[] {
  return [
    // First copy is F0, then 1 dupe per level to F10 (11 copies).
    { id: 'diamond', label: 'Diamond', kind: 'character', color: '#7fd8ff', dupesPerLevel: ones(10), fusionMax: 10, goal: 'max', hasGuests: true, fusionUpThreshold: 3, fusionUpKards: 0 },
    // F0..F10 then A1..A10 (set each card's own cap to A5 or A10).
    { id: 'gold', label: 'Gold', kind: 'character', color: '#f2c14e', dupesPerLevel: ones(20), fusionMax: 10, goal: 'max', hasGuests: false, fusionUpThreshold: 3, fusionUpKards: 0 },
    { id: 'blood-ruby', label: 'Blood Ruby Equip', kind: 'equipment', color: '#ff4d6d', dupesPerLevel: ones(10), fusionMax: 10, goal: 'max', hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0 },
    // Only tracked until F3 (4 copies from scratch); Fusion Up Kards finish them.
    { id: 'epic', label: 'Epic Equip', kind: 'equipment', color: '#c38bff', dupesPerLevel: ones(10), fusionMax: 10, goal: 'threshold', hasGuests: false, fusionUpThreshold: 3, fusionUpKards: 0 },
    { id: 'rare', label: 'Rare Equip', kind: 'equipment', color: '#6fcf97', dupesPerLevel: ones(10), fusionMax: 10, goal: 'threshold', hasGuests: false, fusionUpThreshold: 3, fusionUpKards: 0 },
  ];
}

export function defaultState(): AppState {
  return {
    version: 2,
    rarities: defaultRarities(),
    currencies: [
      { id: 'souls', name: 'Souls', balance: 0 },
      { id: 'blood-rubies', name: 'Blood Rubies', balance: 0 },
      { id: 'dragon-krystals', name: 'Dragon Krystals', balance: 0 },
      { id: 'time-krystals', name: 'Time Krystals', balance: 0 },
    ],
    cards: [],
    packs: [],
    towers: [],
    weights: structuredClone(defaultWeights),
  };
}

/** Small made-up dataset so the planner has something to show. */
export function sampleState(): AppState {
  const s = defaultState();
  const inDays = (d: number) => {
    const t = new Date(Date.now() + d * 86400000);
    t.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };
  s.currencies[0].balance = 1200;
  s.currencies[1].balance = 900;
  s.rarities[0].fusionUpKards = 3;
  s.cards = [
    // Stored levels: 1 = F0, 3 = F2, 11 = F10, 14 = A3 …
    { id: 'c1', name: 'Klassic Sub-Zero', rarityId: 'diamond', fusion: 3, tier: 'must', guest: false },
    { id: 'c2', name: 'Guest Rambo', rarityId: 'diamond', fusion: 0, tier: 'want', guest: true },
    { id: 'c3', name: 'Dark Raiden', rarityId: 'diamond', fusion: 7, tier: 'must', guest: false },
    { id: 'c4', name: 'Shaolin Liu Kang', rarityId: 'diamond', fusion: 2, tier: 'nice', guest: false },
    { id: 'c5', name: 'Kold War Scorpion', rarityId: 'gold', fusion: 14, tier: 'want', guest: false },
    { id: 'c6', name: 'Cryomancer Frost', rarityId: 'gold', fusion: 13, maxLevel: 16, tier: 'nice', guest: false },
    { id: 'c7', name: 'Blood Ruby Talisman', rarityId: 'blood-ruby', fusion: 5, tier: 'want', guest: false },
    { id: 'c8', name: 'Kombat Kunai', rarityId: 'epic', fusion: 2, tier: 'want', guest: false, source: 'krypt' },
    { id: 'c9', name: 'Lin Kuei Gloves', rarityId: 'rare', fusion: 3, tier: 'nice', guest: false },
  ];
  s.packs = [
    {
      id: 'p1', name: 'Guest Pack', currencyId: 'souls', cost: 400, rolls: 1, maxPurchases: 5, purchased: 0,
      startsAt: null, endsAt: inDays(3),
      drops: [{ cardId: 'c2', chance: 5 }, { cardId: 'c1', chance: 3 }, { cardId: 'c3', chance: 3 }],
    },
    {
      id: 'p2', name: 'Diamond Pack', currencyId: 'souls', cost: 350, rolls: 1, maxPurchases: null, purchased: 0,
      startsAt: null, endsAt: null,
      drops: [{ cardId: 'c1', chance: 2 }, { cardId: 'c3', chance: 2 }, { cardId: 'c4', chance: 2 }],
    },
    {
      id: 'p3', name: 'Gold Kollection Pack', currencyId: 'souls', cost: 150, rolls: 1, maxPurchases: 10, purchased: 0,
      startsAt: null, endsAt: inDays(6),
      drops: [{ cardId: 'c5', chance: 10 }, { cardId: 'c6', chance: 10 }, { cardId: 'c9', chance: 4 }],
    },
    {
      id: 'p4', name: 'Blood Ruby Talisman', currencyId: 'blood-rubies', cost: 300, rolls: 1, maxPurchases: 2, purchased: 0,
      startsAt: null, endsAt: inDays(2), store: true,
      drops: [{ cardId: 'c7', chance: 100 }],
    },
  ];
  s.towers = [
    { id: 't1', tower: 'Kold Tower', grade: 'Epic', goal: 'F3', itemsLeft: 4 },
    { id: 't2', tower: 'Twisted Tower', grade: 'Uncommon', goal: 'max', itemsLeft: 1 },
  ];
  return s;
}
