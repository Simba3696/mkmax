// Kaskets: shop packs that give one random card of a rarity you don't own, or one you haven't maxed once you own
// them all. The pool leaves out the newest characters and gear from the latest game update (KASKET_EXCLUDED), so
// the planner works out each Kasket's drops from your cards (engine kasketPool) instead of a saved drop list.
import { nameKey } from './catalog';
import type { Card } from './types';

/** The shop's Kaskets and the rarity each one draws from (MK Mobile Base's event schedule names). */
const KASKET_RARITY: Record<string, string> = {
  'Kollector’s Diamond Kasket': 'diamond',
  'Kollector’s Gold Kasket': 'gold',
  'Event Epic Equipment Kasket': 'epic',
  'Event Rare Equipment Kasket': 'rare',
};

/**
 * The newest characters and gear, which Kaskets leave out until the next update. From the 22 July 2026 update
 * (7.3). Replace the list each update via the patch-notes skill.
 */
const KASKET_EXCLUDED = ['Sub-Zero MK1', 'Scorpion MK2 Movie', 'Man in Control', 'Flame Forged Will', 'Man in the Sky', 'Flame Forged Ferocity'];

const RARITY_BY_KEY = new Map(Object.entries(KASKET_RARITY).map(([name, rarity]) => [nameKey(name), rarity]));
const EXCLUDED = new Set(KASKET_EXCLUDED.map(nameKey));

/** The rarity a shop Kasket draws from, by name (word order and apostrophes don't matter); undefined for other packs. */
export const kasketFor = (name: string) => RARITY_BY_KEY.get(nameKey(name));

/** Whether a card is one of the newest that Kaskets leave out. */
export const isKasketExcluded = (card: Pick<Card, 'name'>) => EXCLUDED.has(nameKey(card.name));
