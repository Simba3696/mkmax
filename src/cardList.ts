// Parses a pasted list of cards for bulk adding. Plain TS so it can be tested.
import { nameKey } from './catalog';
import { fLevel, maxFusion } from './engine';
import type { Card, RarityRule } from './types';

export interface ListedCard {
  name: string;
  rarityId: string;
  /** Stored level from the line (e.g. "F2" → 3, "Unowned" → 0); unset means not owned. */
  fusion?: number;
  source?: Card['source'];
  sourceNote?: string;
}

export interface CardUpdate {
  cardId: string;
  name: string;
  patch: Partial<Pick<Card, 'fusion' | 'source' | 'sourceNote'>>;
}

export interface ParsedList {
  cards: ListedCard[];
  /** Cards already in the app that the line gives a level or source for. */
  updates: CardUpdate[];
  /** Names skipped because that card is already in the app (with nothing to update) or earlier in the list. */
  duplicates: string[];
  /** Lines that couldn't be used, with why. */
  problems: { line: string; reason: string }[];
}

/** Grades the game has that aren't tracked as cards here. */
const UNTRACKED_GRADES: Record<string, string> = {
  common: 'Common gear isn’t tracked',
};

/** A rarity named by its id or label, or the label's first word ("Epic" for "Epic Equip"). */
function findRarity(word: string, rarities: RarityRule[]) {
  const w = word.toLowerCase();
  return (
    rarities.find((r) => r.id === w || r.label.toLowerCase() === w) ??
    rarities.find((r) => r.kind !== 'kameo' && r.label.toLowerCase().split(' ')[0] === w)
  );
}

/** "F2" → stored level 3, "A3" → past the top fusion, "Unowned" → 0. Null if it isn't a level. */
function parseLevel(word: string, rule: RarityRule | undefined): number | null {
  if (/^(unowned|not owned|none|new)$/i.test(word)) return 0;
  const m = /^([FA])\s?(\d+)$/i.exec(word);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1].toUpperCase() === 'F' ? fLevel(n) : fLevel(rule?.fusionMax ?? 10) + n;
}

/**
 * One card per line. A line can be just a name ("Jade, Lizard"), or a name followed by " - " parts in any order:
 * rarity ("Epic"), where it comes from ("Krypt Gear", or a tower name like "Kold Tower"), and level ("F2",
 * "Unowned"). A line that's only a rarity's name (e.g. "Gold Kameo") switches the rarity for the lines after it,
 * so lists copied from notes with headings work as-is. Underline rows ("-----") and blank lines are skipped.
 */
export function parseCardList(text: string, rarities: RarityRule[], startRarityId: string, existing: Card[]): ParsedList {
  const byKey = new Map(existing.map((c) => [`${c.rarityId}|${nameKey(c.name)}`, c]));
  const seen = new Set<string>();
  let headingRarityId = startRarityId;
  const out: ParsedList = { cards: [], updates: [], duplicates: [], problems: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line || /^[-=_*\s]+$/.test(line)) continue;
    const [name, ...parts] = line.split(/\s+[-–—]\s+/);
    if (parts.length === 0) {
      const heading = findRarity(line.replace(/:$/, ''), rarities);
      if (heading && heading.label.toLowerCase() === line.replace(/:$/, '').toLowerCase()) {
        headingRarityId = heading.id;
        continue;
      }
    }

    let rarityId: string | undefined;
    let levelWord: string | undefined;
    let source: Card['source'];
    let sourceNote: string | undefined;
    let problem: string | undefined;
    for (const part of parts) {
      const untracked = UNTRACKED_GRADES[part.toLowerCase()];
      const rule = findRarity(part, rarities);
      if (untracked) problem = untracked;
      else if (rule) rarityId = rule.id;
      else if (/^krypt/i.test(part)) source = 'krypt';
      else if (/tower/i.test(part)) [source, sourceNote] = ['tower', part];
      else if (parseLevel(part, undefined) != null) levelWord = part;
      else problem = `"${part}" isn’t a rarity, source or level`;
    }
    // Lines with details but no rarity are ambiguous (the heading rarity is for plain name lists).
    if (!problem && parts.length > 0 && !rarityId) problem = 'No rarity (e.g. Epic, Rare)';
    rarityId ??= headingRarityId;
    const rule = rarities.find((r) => r.id === rarityId);
    const fusion = levelWord == null ? undefined : parseLevel(levelWord, rule)!;
    if (!problem && rule && fusion != null && fusion > maxFusion(rule)) problem = `${levelWord} is past this rarity’s max`;
    if (problem) {
      out.problems.push({ line, reason: problem });
      continue;
    }

    const key = `${rarityId}|${nameKey(name)}`;
    if (seen.has(key)) {
      out.duplicates.push(name);
      continue;
    }
    seen.add(key);
    const card = byKey.get(key);
    if (card) {
      const patch: CardUpdate['patch'] = {};
      if (fusion != null && fusion !== card.fusion) patch.fusion = fusion;
      if (source && (source !== card.source || sourceNote !== card.sourceNote)) Object.assign(patch, { source, sourceNote });
      if (Object.keys(patch).length) out.updates.push({ cardId: card.id, name: card.name, patch });
      else out.duplicates.push(name);
      continue;
    }
    out.cards.push({ name, rarityId, ...(fusion != null && { fusion }), ...(source && { source }), ...(sourceNote && { sourceNote }) });
  }
  return out;
}
