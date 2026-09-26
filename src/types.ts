export type Kind = 'character' | 'equipment';
export type Tier = 'must' | 'want' | 'nice' | 'skip';

/** Fusion rules for one rarity (e.g. Diamond characters, Legendary equipment). */
export interface RarityRule {
  id: string;
  label: string;
  kind: Kind;
  color: string;
  /** dupesPerLevel[i] = duplicate copies needed to go from level i+1 to i+2. Max level = length + 1. */
  dupesPerLevel: number[];
  /** Highest fusion number (F10); levels past it are ascension (A1, A2, …). */
  fusionMax: number;
  /** 'threshold' = only track until the Fusion Up Kard threshold; kards finish the rest. */
  goal: 'max' | 'threshold';
  /** Whether cards of this rarity can be guest / limited-event cards. */
  hasGuests: boolean;
  /** Fusion number (F3 → 3) at which Fusion Up Kards can be used; null if this rarity has none. */
  fusionUpThreshold: number | null;
  /** Fusion Up Kards currently held for this rarity (1 kard = +1 fusion level). */
  fusionUpKards: number;
}

export interface Card {
  id: string;
  name: string;
  rarityId: string;
  /** Stored copy level: 0 = not owned, 1 = F0 (first copy), 11 = F10, then ascension. See engine levelLabel. */
  fusion: number;
  /** Per-card cap below the rarity max, as a stored level (e.g. a gold card that only ascends to A5). */
  maxLevel?: number | null;
  tier: Tier;
  /** Guest / limited-event card — only obtainable for a short time. */
  guest: boolean;
  /** Gear that comes from the Krypt or a tower: tracked, but not planned for unless a pack sells it. */
  source?: 'krypt' | 'tower';
  /** e.g. the tower it drops from. */
  sourceNote?: string;
  /** Card art URL (found on the MK Mobile wiki, or pasted by hand). */
  imageUrl?: string;
  /** Wiki page the image came from. */
  wikiTitle?: string;
  notes?: string;
}

export interface Currency {
  id: string;
  name: string;
  balance: number;
}

export interface DropEntry {
  cardId: string;
  /** Percent chance per roll. */
  chance: number;
}

export interface Pack {
  id: string;
  name: string;
  currencyId: string;
  cost: number;
  /** Cards rolled per purchase. */
  rolls: number;
  /** null = unlimited. */
  maxPurchases: number | null;
  purchased: number;
  /** Local datetime strings (from datetime-local inputs); null = no bound. */
  startsAt: string | null;
  endsAt: string | null;
  drops: DropEntry[];
  /** Store item: one guaranteed copy of a single card per purchase. */
  store?: boolean;
  notes?: string;
}

export interface Weights {
  tier: Record<Tier, number>;
  /** Multiplier for the copy that unlocks a card you don't own. */
  unlock: number;
  /** Multiplier for copies that get a card up to the Fusion Up Kard threshold. */
  belowThreshold: number;
  /** Multiplier for copies your Fusion Up Kards would already cover. */
  coveredByKards: number;
  guest: number;
  /** Up to this much extra value as a card nears max (0.5 = +50% at max). */
  closenessBonus: number;
  /** Ranking boost for limited-time packs over permanent ones in the planner. */
  limitedBoost: number;
}

/** Per-tower count of gear still short of its goal — a focus list, not per-item tracking. */
export interface TowerEntry {
  id: string;
  tower: string;
  /** Gear grade label, e.g. "Uncommon", "Rare", "Epic". */
  grade: string;
  /** What "done" means for this tower's gear. */
  goal: 'F3' | 'max';
  /** Items from this tower still short of the goal; null = not counted. */
  itemsLeft: number | null;
}

export interface AppState {
  /** 2 = levels stored from F0 (first copy = 1). Version 1 stored the first copy as F1. */
  version: 2;
  rarities: RarityRule[];
  currencies: Currency[];
  cards: Card[];
  packs: Pack[];
  towers: TowerEntry[];
  weights: Weights;
  /** When this data was last changed (ms since epoch); drives cross-device sync. */
  updatedAt?: number;
}
