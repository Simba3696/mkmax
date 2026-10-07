/** Kameos only need one copy: owning it is the goal. */
export type Kind = 'character' | 'equipment' | 'kameo';

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
  /** Fusion Up Kards currently held for this rarity. */
  fusionUpKards: number;
  /**
   * Fusion Up Kards needed per step, indexed by the fusion number you start from: kardsPerLevel[3] is F3 → F4.
   * Past fusionMax the steps are ascension: kardsPerLevel[10] is F10 → A1, [11] is A1 → A2.
   * 0 means kards can't be used for that step (below the threshold).
   */
  kardsPerLevel: number[];
}

export interface Card {
  id: string;
  name: string;
  rarityId: string;
  /** Stored copy level: 0 = not owned, 1 = F0 (first copy), 11 = F10, then ascension. See engine levelLabel. */
  fusion: number;
  /** Per-card cap below the rarity max, as a stored level (e.g. a gold card that only ascends to A5). */
  maxLevel?: number | null;
  /** Overrides the rarity's goal, e.g. Realm Klash epics are bought all the way to max while other epics stop at F3. */
  goal?: 'max' | 'threshold';
  /** Guest / limited-event card — only obtainable for a short time. */
  guest: boolean;
  /**
   * Where it comes from besides packs: Krypt or tower gear, or a Kameo from an Elder challenge. Tracked, but not
   * planned for unless a pack sells it.
   */
  source?: 'krypt' | 'tower' | 'challenge';
  /** e.g. the tower it drops from. */
  sourceNote?: string;
  /** Card art URL (found on the MK Mobile wiki, or pasted by hand). */
  imageUrl?: string;
  /** Wiki page the image came from (older lookups and wiki fallbacks). */
  wikiTitle?: string;
  /** Page the image was found on (mkmobilebase.com or the wiki); unset for a pasted URL. */
  imagePage?: string;
  notes?: string;
}

export interface Currency {
  id: string;
  name: string;
  balance: number;
  /** Roughly how much comes in each day (Blood Rubies: 65 or more), for "you can afford it in N days". */
  perDay?: number;
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
  /**
   * Blood Ruby store item or pack that rotates out when the Realm Klash season ends (characters, Kameos, Kameo
   * packs). Its endsAt is set to that season's end when saved. Realm Klash gear doesn't rotate, so it's false.
   */
  season?: boolean;
  notes?: string;
}

export interface Weights {
  /** Multiplier for the copy that unlocks a card you don't own. */
  unlock: number;
  /** Multiplier for copies that get a card up to the Fusion Up Kard threshold. */
  belowThreshold: number;
  /** Multiplier for copies your Fusion Up Kards would already cover. */
  coveredByKards: number;
  guest: number;
  /** Multiplier for Kameo copies; low by default so gear and characters come first, Kameos after. */
  kameo: number;
  /** Extra multiplier for Kameos an Elder challenge gives for sure, so Kameo packs are valued for the others. */
  challenge: number;
  /** Up to this much extra value as a card nears max (0.5 = +50% at max). */
  closenessBonus: number;
  /** Ranking boost for limited-time packs over permanent ones in the planner. */
  limitedBoost: number;
}

export interface AppState {
  /** 2 = levels stored from F0 (first copy = 1; version 1 stored it as F1). 3 = added a Kameo rarity. 4 = split it into Diamond and Gold Kameos. 5 = tagged challenge Kameos. 6 = added Uncommon gear. 7 = untagged retired challenge Kameos. 8–9 = renamed packs and cards to the game's spelling. 10 = fixed "Kollector’S" pack names and gave Blood Rubies a daily income. 11 = removed Time Krystals (console-only) when unused. 12 = gave Epic and Rare gear their own kard costs and Kameos guests. 13 = gave Gold ascension the game's kard costs. 14 = switched rarities with no kards from the kard threshold to max. */
  version: 14;
  rarities: RarityRule[];
  currencies: Currency[];
  cards: Card[];
  packs: Pack[];
  weights: Weights;
  /** End of a Realm Klash season (datetime-local). Seasons run back to back for 2 weeks; see engine seasonEnd. */
  realmKlashSeasonEnd?: string | null;
  /** Shop packs from MK Mobile Base's schedule the user marked as not needed, by name, so they aren't suggested. */
  dismissedShopPacks?: string[];
  /** Realm Klash gear card ids in the order Blood Rubies max them, one at a time, before any other purchase. */
  gearOrder?: string[];
  /** When this data was last changed (ms since epoch); drives cross-device sync. */
  updatedAt?: number;
}
