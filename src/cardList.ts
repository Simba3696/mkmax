// Parses a pasted list of card names for bulk adding. Plain TS so it can be tested.
import { nameKey } from './catalog';
import type { Card, RarityRule } from './types';

export interface ListedCard {
  name: string;
  rarityId: string;
}

export interface ParsedList {
  cards: ListedCard[];
  /** Names skipped because that card (same name words and rarity) is already in the app or earlier in the list. */
  duplicates: string[];
}

/**
 * One card name per line. A line that's just a rarity's name (e.g. "Gold Kameo") switches the rarity for the
 * lines after it, so lists copied from notes with headings work as-is. Underline rows ("-----") and blank lines
 * are skipped.
 */
export function parseCardList(text: string, rarities: RarityRule[], startRarityId: string, existing: Card[]): ParsedList {
  const byLabel = new Map(rarities.map((r) => [r.label.toLowerCase(), r.id]));
  const seen = new Set(existing.map((c) => `${c.rarityId}|${nameKey(c.name)}`));
  let rarityId = startRarityId;
  const cards: ListedCard[] = [];
  const duplicates: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line || /^[-=_*\s]+$/.test(line)) continue;
    const heading = byLabel.get(line.replace(/:$/, '').toLowerCase());
    if (heading) {
      rarityId = heading;
      continue;
    }
    const key = `${rarityId}|${nameKey(line)}`;
    if (seen.has(key)) {
      duplicates.push(line);
      continue;
    }
    seen.add(key);
    cards.push({ name: line, rarityId });
  }
  return { cards, duplicates };
}
