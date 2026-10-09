// Parses a pasted list of cards for bulk adding. Plain TS so it can be tested.
import { nameKey } from './catalog';
import { ascensionCaps, fLevel, levelLabel, maxFusion } from './engine';
import type { Card, RarityRule } from './types';

export interface ListedCard {
  name: string;
  rarityId: string;
  /** Stored level from the line (e.g. "F2" → 3, "Unowned" → 0); unset means not owned. */
  fusion?: number;
  source?: Card['source'];
  sourceNote?: string;
  /** The Max from a "Stage I" or "Stage II" part; null is the rarity's top level, as the Max select stores it. */
  maxLevel?: number | null;
}

export interface CardUpdate {
  cardId: string;
  name: string;
  patch: Partial<Pick<Card, 'fusion' | 'source' | 'sourceNote' | 'maxLevel'>>;
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

/** "Stage I" → 1, "Stage II" → 2 (the game's names for ascending to A5 and to A10). Null if it isn't a stage. */
function parseStage(word: string): 1 | 2 | null {
  const m = /^stage\s*(ii|2|i|1)$/i.exec(word);
  return m ? (/^(ii|2)$/i.test(m[1]) ? 2 : 1) : null;
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
 * rarity ("Epic"), where it comes from ("Krypt Gear", or a tower name like "Kold Tower"), level ("F2",
 * "Unowned"), and for Gold an ascension stage ("Stage I" is a Max of A5, "Stage II" A10). A line that's only a
 * rarity's name (e.g. "Gold Kameo") switches the rarity for the lines after it, so lists copied from notes with
 * headings work as-is. Underline rows ("-----") and blank lines are skipped, and a leading bullet or number is
 * dropped.
 */
export function parseCardList(text: string, rarities: RarityRule[], startRarityId: string, existing: Card[]): ParsedList {
  const byKey = new Map(existing.map((c) => [`${c.rarityId}|${nameKey(c.name)}`, c]));
  const seen = new Set<string>();
  let headingRarityId = startRarityId;
  const out: ParsedList = { cards: [], updates: [], duplicates: [], problems: [] };
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed || /^[-=_*\s]+$/.test(trimmed)) continue;
    // Lists copied from notes often have bullets or numbers ("- Jade, Lizard", "2. Kori Blade"), which aren't part of the name.
    const line = trimmed.replace(/^(?:[-–—*•·]|\d+[.)])\s+/, '');
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
    let stage: 1 | 2 | null = null;
    let problem: string | undefined;
    for (const part of parts) {
      const untracked = UNTRACKED_GRADES[part.toLowerCase()];
      const rule = findRarity(part, rarities);
      if (untracked) problem = untracked;
      else if (rule) rarityId = rule.id;
      else if (/^krypt/i.test(part)) source = 'krypt';
      else if (/tower/i.test(part)) [source, sourceNote] = ['tower', part];
      else if (parseLevel(part, undefined) != null) levelWord = part;
      else if (parseStage(part)) stage = parseStage(part);
      else problem = `"${part}" isn’t a rarity, source, level or stage`;
    }
    // Lines with details but no rarity are ambiguous (the heading rarity is for plain name lists).
    if (!problem && parts.length > 0 && !rarityId) problem = 'No rarity (e.g. Epic, Rare)';
    rarityId ??= headingRarityId;
    const rule = rarities.find((r) => r.id === rarityId);
    const fusion = levelWord == null ? undefined : parseLevel(levelWord, rule)!;
    if (!problem && rule && fusion != null && fusion > maxFusion(rule)) problem = `${levelWord} is past this rarity’s max`;
    // Only gear is tracked as Krypt or tower gear. A character or Kameo tagged that way would drop out of the plan.
    if (!problem && rule && source && rule.kind !== 'equipment') problem = 'Only gear comes from the Krypt or a tower';
    // A stage is a Max: Stage I ascends to A5, Stage II to A10 (stored as null when it's the rarity's top level).
    let maxLevel: number | null | undefined;
    if (!problem && rule && stage) {
      const cap = fLevel(rule.fusionMax) + stage * 5;
      if (ascensionCaps(rule).length < 2 || !ascensionCaps(rule).includes(cap)) problem = `${rule.label} cards don’t have Stage ${stage === 1 ? 'I' : 'II'} ascension`;
      else maxLevel = cap === maxFusion(rule) ? null : cap;
    }
    const cap = maxLevel === undefined ? undefined : (maxLevel ?? maxFusion(rule!));
    if (!problem && cap != null && fusion != null && fusion > cap) problem = `${levelWord} is past Stage ${stage === 1 ? 'I' : 'II'}’s ${levelLabel(rule!, cap)}`;
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
      // Lowering the Max below the card's level would count it as maxed and delete it.
      if (cap != null && (fusion ?? card.fusion) > cap) {
        out.problems.push({ line, reason: `Already ${levelLabel(rule!, card.fusion)}, past Stage ${stage === 1 ? 'I' : 'II'}’s ${levelLabel(rule!, cap)}` });
        continue;
      }
      const patch: CardUpdate['patch'] = {};
      if (fusion != null && fusion !== card.fusion) patch.fusion = fusion;
      if (source && (source !== card.source || sourceNote !== card.sourceNote)) Object.assign(patch, { source, sourceNote });
      if (maxLevel !== undefined && maxLevel !== (card.maxLevel ?? null)) patch.maxLevel = maxLevel;
      if (Object.keys(patch).length) out.updates.push({ cardId: card.id, name: card.name, patch });
      else out.duplicates.push(name);
      continue;
    }
    // Every card still being maxed is in the app, so a Gold card made ascendable that isn't was maxed and removed:
    // it comes back at the cap below its new stage (F10 for Stage I, A5 for Stage II), with 5 copies to go. The
    // same name under another rarity means the card is still here, just filed wrong, so that's a problem instead.
    const elsewhere = stage && fusion == null ? existing.find((c) => c.rarityId !== rarityId && nameKey(c.name) === nameKey(name)) : undefined;
    if (elsewhere) {
      out.problems.push({ line, reason: `Listed as ${rarities.find((r) => r.id === elsewhere.rarityId)?.label ?? elsewhere.rarityId}: change its rarity on the card first` });
      continue;
    }
    const start = fusion ?? (stage ? fLevel(rule!.fusionMax) + (stage - 1) * 5 : undefined);
    out.cards.push({
      name,
      rarityId,
      ...(start != null && { fusion: start }),
      ...(source && { source }),
      ...(sourceNote && { sourceNote }),
      ...(maxLevel !== undefined && { maxLevel }),
    });
  }
  return out;
}
