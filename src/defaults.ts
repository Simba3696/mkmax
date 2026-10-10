import type { AppState, RarityRule, Weights } from './types';

const ones = (n: number) => Array(n).fill(1);

/**
 * Fusion Up Kards per step from F3, for Diamond cards (from the game): F3→F4 1, F4→F5 2, F5→F6 3, F6→F7 4,
 * F7→F8 5, F8→F9 7, F9→F10 10. Gold uses the same table up to F10.
 */
export const DIAMOND_KARD_COSTS = [0, 0, 0, 1, 2, 3, 4, 5, 7, 10];
const kardCosts = () => [...DIAMOND_KARD_COSTS];
/** Epic and Rare gear kards per step from F3 (from the game): 1, 3, 5, 7, 9, 12, 15. */
export const GEAR_KARD_COSTS = [0, 0, 0, 1, 3, 5, 7, 9, 12, 15];
/**
 * Fusion Up Kards for each Gold ascension step, F10→A1 … A9→A10, in place of the step's duplicate (from the game).
 * Each step also takes Ascension Kards (1, 1, 2, 2, 3, 3, 3, 4, 4, 5), which aren't tracked.
 */
export const ASCENSION_KARD_COSTS = [10, 11, 12, 13, 15, 22, 24, 26, 28, 30];
/** Kards for a step past any known table (a custom rarity's extra levels): the same as F9→F10. */
export const ASCENSION_KARD_COST = 10;

export const defaultWeights: Weights = {
  unlock: 1.3,
  belowThreshold: 1.5,
  coveredByKards: 0.3,
  guest: 1.5,
  kameo: 0.25,
  challenge: 0.2,
  closenessBonus: 0.5,
  limitedBoost: 1.25,
};

export function defaultRarities(): RarityRule[] {
  return [
    // First copy is F0, then 1 dupe per level to F10 (11 copies).
    { id: 'diamond', label: 'Diamond', kind: 'character', color: '#7fd8ff', dupesPerLevel: ones(10), fusionMax: 10, goal: 'max', hasGuests: true, fusionUpThreshold: 3, fusionUpKards: 0, kardsPerLevel: kardCosts() },
    // F0..F10 then A1..A10 (set each card's own cap to A5 or A10). Gold has guests too (Jason Voorhees, Slasher).
    { id: 'gold', label: 'Gold', kind: 'character', color: '#f2c14e', dupesPerLevel: ones(20), fusionMax: 10, goal: 'max', hasGuests: true, fusionUpThreshold: 3, fusionUpKards: 0, kardsPerLevel: [...kardCosts(), ...ASCENSION_KARD_COSTS] },
    // Equipment colors match the game: Epic purple, Rare blue, Uncommon green.
    // Only tracked until F3 (4 copies from scratch); Fusion Up Kards finish them. Realm Klash gear is Epic too,
    // but those cards override the goal to max because they're bought outright.
    { id: 'epic', label: 'Epic Equip', kind: 'equipment', color: '#c38bff', dupesPerLevel: ones(10), fusionMax: 10, goal: 'threshold', hasGuests: false, fusionUpThreshold: 3, fusionUpKards: 0, kardsPerLevel: [...GEAR_KARD_COSTS] },
    { id: 'rare', label: 'Rare Equip', kind: 'equipment', color: '#4da3ff', dupesPerLevel: ones(10), fusionMax: 10, goal: 'threshold', hasGuests: false, fusionUpThreshold: 3, fusionUpKards: 0, kardsPerLevel: [...GEAR_KARD_COSTS] },
    // Uncommon (green) gear is farmed from towers and taken to max; no Fusion Up Kards until checked in-game.
    { id: 'uncommon', label: 'Uncommon Equip', kind: 'equipment', color: '#5fd068', dupesPerLevel: ones(10), fusionMax: 10, goal: 'max', hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [] },
    // Kameos fuse to F10 in the game, but only owning one matters here: no duplicate steps, so the first copy (F0) is the goal.
    // Kameos come in Diamond and Gold, like characters, and both have guests (Ghostface, Jason Voorhees).
    { id: 'kameo-diamond', label: 'Diamond Kameo', kind: 'kameo', color: '#ff7ab8', dupesPerLevel: [], fusionMax: 0, goal: 'max', hasGuests: true, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [] },
    { id: 'kameo-gold', label: 'Gold Kameo', kind: 'kameo', color: '#ffb35c', dupesPerLevel: [], fusionMax: 0, goal: 'max', hasGuests: true, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [] },
  ];
}

export function defaultState(): AppState {
  return {
    version: 15,
    rarities: defaultRarities(),
    currencies: [
      { id: 'souls', name: 'Souls', balance: 0 },
      { id: 'blood-rubies', name: 'Blood Rubies', balance: 0, perDay: 65 },
      { id: 'dragon-krystals', name: 'Dragon Krystals', balance: 0 },
    ],
    cards: [],
    packs: [],
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
    { id: 'c1', name: 'Klassic Sub-Zero', rarityId: 'diamond', fusion: 3, guest: false },
    { id: 'c2', name: 'Guest Rambo', rarityId: 'diamond', fusion: 0, guest: true },
    { id: 'c3', name: 'Dark Raiden', rarityId: 'diamond', fusion: 7, guest: false },
    { id: 'c4', name: 'Shaolin Liu Kang', rarityId: 'diamond', fusion: 2, guest: false },
    { id: 'c5', name: 'Kold War Scorpion', rarityId: 'gold', fusion: 14, guest: false },
    { id: 'c6', name: 'Cryomancer Frost', rarityId: 'gold', fusion: 13, maxLevel: 16, guest: false },
    { id: 'c7', name: 'Blood Ruby Talisman', rarityId: 'epic', fusion: 5, goal: 'max', guest: false },
    { id: 'c8', name: 'Kombat Kunai', rarityId: 'epic', fusion: 2, guest: false, source: 'krypt' },
    { id: 'c9', name: 'Lin Kuei Gloves', rarityId: 'rare', fusion: 3, guest: false },
    { id: 'c10', name: 'Kori Blade', rarityId: 'epic', fusion: 2, guest: false, source: 'tower', sourceNote: 'Lin Kuei Tower' },
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
  return s;
}
