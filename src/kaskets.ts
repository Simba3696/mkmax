// Kaskets: shop packs that give one random card of a rarity you don't own, or one you haven't maxed once you own
// them all. The pool leaves out the newest characters and gear from the latest game update (KASKET_EXCLUDED), so
// the planner works out each Kasket's drops from your cards (engine kasketPool) instead of a saved drop list.
import { nameKey } from './catalog';
import type { Card, RarityRule } from './types';

/** The shop's Kaskets and the rarity each one draws from (MK Mobile Base's event schedule names). */
const KASKET_RARITY: Record<string, string> = {
  'Kollector’s Diamond Kasket': 'diamond',
  'Kollector’s Gold Kasket': 'gold',
  'Event Epic Equipment Kasket': 'epic',
  'Event Rare Equipment Kasket': 'rare',
};

/**
 * The newest characters and gear, which Kaskets leave out until the next update, with each one's rarity, so a
 * same-named card of another rarity still counts. From the 22 July 2026 update (7.3). Replace the list each update
 * via the patch-notes skill.
 */
const KASKET_EXCLUDED: [name: string, rarityId: string][] = [
  ['Sub-Zero MK1', 'diamond'],
  ['Scorpion MK2 Movie', 'diamond'],
  ['Man in Control', 'epic'],
  ['Flame Forged Will', 'epic'],
  ['Man in the Sky', 'rare'],
  ['Flame Forged Ferocity', 'rare'],
];

const RARITY_BY_KEY = new Map(Object.entries(KASKET_RARITY).map(([name, rarity]) => [nameKey(name), rarity]));
const excludedKey = (name: string, rarityId: string) => `${rarityId}:${nameKey(name)}`;
const EXCLUDED = new Set(KASKET_EXCLUDED.map(([name, rarityId]) => excludedKey(name, rarityId)));

/** The rarity a shop Kasket draws from, by name (word order and apostrophes don't matter); undefined for other packs. */
export const kasketFor = (name: string) => RARITY_BY_KEY.get(nameKey(name));

/**
 * kasketFor, but only when the save still has that rarity and it isn't a Kameo rarity. A save whose built-in rarity
 * was deleted or rebuilt under a new id keeps the pack's typed odds instead of getting a Kasket of a missing rarity.
 */
export function kasketIn(name: string, rarities: Pick<RarityRule, 'id' | 'kind'>[]) {
  const id = kasketFor(name);
  return id && rarities.some((r) => r.id === id && r.kind !== 'kameo') ? id : undefined;
}

/** Whether a card is one of the newest that Kaskets leave out: same name and same rarity. */
export const isKasketExcluded = (card: Pick<Card, 'name' | 'rarityId'>) => EXCLUDED.has(excludedKey(card.name, card.rarityId));
