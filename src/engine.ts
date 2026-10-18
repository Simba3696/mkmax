import { nameKey } from './catalog';
import { isKasketExcluded } from './kaskets';
import type { AppState, Card, DropEntry, MaxedCard, Pack, RarityRule } from './types';

// ---------- Fusion math ----------
// Levels are stored as "copy levels": 0 = not owned, 1 = first copy (F0), 2 = F1, … fusionMax + 1 = F10,
// then ascension A1, A2, … Display F/A numbers go through levelLabel / fLevel.

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const maxFusion = (rule: RarityRule) => rule.dupesPerLevel.length + 1;
export const copiesTotal = (rule: RarityRule) => 1 + sum(rule.dupesPerLevel);

/** Stored level for a displayed fusion number (F3 → 4). */
export const fLevel = (f: number) => f + 1;

/** "F7" for fusion levels, "A3" for ascension levels. */
export function levelLabel(rule: RarityRule | undefined, level: number) {
  if (level <= 0) return 'Not owned';
  const f = level - 1;
  return !rule || f <= rule.fusionMax ? `F${f}` : `A${f - rule.fusionMax}`;
}

/** Copies represented by being at stored level `level` (0 = not owned). */
export function copiesAtFusion(rule: RarityRule, level: number) {
  return level <= 0 ? 0 : 1 + sum(rule.dupesPerLevel.slice(0, level - 1));
}

/** The caps a card can have (stored levels): its top fusion (no ascension), A5 and the rarity's max, when it ascends. */
export function ascensionCaps(rule: RarityRule) {
  const top = fLevel(rule.fusionMax);
  const max = maxFusion(rule);
  return max <= top ? [max] : [...new Set([top, Math.min(top + 5, max), max])];
}

/** Stored level where Fusion Up Kards become usable, or null. */
export const thresholdLevel = (rule: RarityRule) => (rule.fusionUpThreshold == null ? null : fLevel(rule.fusionUpThreshold));

/**
 * The card's goal: max for Realm Klash gear (always bought to max) and for a card that can't take kards (stopping at
 * the kard threshold only makes sense when kards finish it), else its own override, else the rarity's.
 */
export const cardGoal = (card: Card, rule: RarityRule) =>
  (rule.kind === 'equipment' && isRealmKlashName(card.name)) || card.noKards ? 'max' : (card.goal ?? rule.goal);

/**
 * The goal a card gets as it's entered (Add card, Paste a list, the pack editor). One typed in already at or past its kard
 * threshold, while tracked only that far, would be done the moment it's saved, so it's tracked on to its next target
 * instead: its max (F10, or a Gold card's own cap). A card levelled up to the threshold later still finishes there.
 */
export function entryGoal(card: Card, rule: RarityRule): Card['goal'] {
  const thr = thresholdLevel(rule);
  return cardGoal(card, rule) === 'threshold' && thr != null && card.fusion >= thr ? 'max' : card.goal;
}

/** The level this card is being worked toward: rarity max, per-card cap, or the kard threshold. */
export function targetLevel(card: Card, rule: RarityRule) {
  let t = maxFusion(rule);
  if (card.maxLevel != null) t = Math.min(t, card.maxLevel);
  const thr = thresholdLevel(rule);
  if (cardGoal(card, rule) === 'threshold' && thr != null) t = Math.min(t, thr);
  return t;
}

export const copiesToMax = (card: Card, rule: RarityRule) =>
  Math.max(0, copiesAtFusion(rule, targetLevel(card, rule)) - copiesAtFusion(rule, card.fusion));

/** Copies to the kard threshold; none for a card that can't take kards, as the threshold means nothing to it. */
export function copiesToThreshold(card: Card, rule: RarityRule) {
  const thr = thresholdLevel(rule);
  if (thr == null || card.noKards) return 0;
  return Math.max(0, copiesAtFusion(rule, thr) - copiesAtFusion(rule, card.fusion));
}

export const isMaxed = (card: Card, rule: RarityRule) => card.fusion >= targetLevel(card, rule);

/** A card's rarity and name key, whatever its case or word order: the same key as cardKey in cardList.ts, which imports this module. */
const recordKey = (c: { rarityId: string; name: string }) => `${c.rarityId}|${nameKey(c.name)}`;

/** YYYY-MM-DD in local time, as the day a card was maxed is shown. */
const dayOf = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Cards that reached their goal are done, so they leave the app: the card, its pack drops, and any store
 * item that only sold done cards. Mutates the state and returns the removed cards' names. One at its top level (its
 * own max, or owned for a Kameo) also goes on the Maxed record, dated `now` when given; one done at its kard threshold
 * isn't maxed yet, since kards finish it in the game.
 *
 * Realm Klash gear also gets a stored goal of max first. The name already makes it max here, but a copy of the app
 * from before the name list only reads the goal, so without it that copy would delete the gear at F3 and sync the
 * deletion back. It also keeps a piece from being removed mid-rename, when the half-typed name is off the list.
 */
export function pruneDone(s: AppState, now?: Date): string[] {
  const rules = new Map(s.rarities.map((r) => [r.id, r]));
  for (const c of s.cards) if (c.goal !== 'max' && rules.get(c.rarityId)?.kind === 'equipment' && isRealmKlashName(c.name)) c.goal = 'max';
  const done = new Set(s.cards.filter((c) => rules.has(c.rarityId) && isMaxed(c, rules.get(c.rarityId)!)).map((c) => c.id));
  if (done.size === 0) return [];
  const names = s.cards.filter((c) => done.has(c.id)).map((c) => c.name);
  const recorded = new Set((s.maxed ?? []).map(recordKey));
  for (const c of s.cards) {
    if (!done.has(c.id) || c.fusion < targetLevel({ ...c, goal: 'max' }, rules.get(c.rarityId)!) || recorded.has(recordKey(c))) continue;
    recorded.add(recordKey(c));
    (s.maxed ??= []).push({ name: c.name, rarityId: c.rarityId, ...(now && { at: dayOf(now) }) });
  }
  s.cards = s.cards.filter((c) => !done.has(c.id));
  s.packs = s.packs.filter((p) => !(p.store && p.drops.length > 0 && p.drops.every((d) => done.has(d.cardId))));
  for (const p of s.packs) p.drops = p.drops.filter((d) => !done.has(d.cardId));
  return names;
}

// ---------- Context ----------

interface KardAssignment {
  cardId: string;
  from: number;
  to: number;
  /** Fusion Up Kards this assignment spends. */
  kards: number;
}

export interface KardPlan {
  assignments: KardAssignment[];
  /** Kards the plan couldn't use: not enough for any remaining character step, or, for gear, to finish the next piece. */
  left: number;
  /** Cards that could take kards: at the threshold or higher, short of their goal, and not Realm Klash gear. */
  cards: number;
  /** Cheapest next step among those cards before any kards are spent, so "not enough kards" can name it. Filled for gear too, but the Plan names `next` there instead. */
  cheapest: number | null;
  /** Realm Klash gear at the threshold or higher and short of its goal, left out of `cards`. */
  realmKlash: number;
  /** Other cards marked No kards at the threshold or higher and short of their goal, left out of `cards`; unset when none. */
  noKards?: number;
  /** Gear only: the first piece the kards left can't finish, and all the kards it needs to reach its goal. */
  next?: { cardId: string; needs: number };
  /** Gear only: pieces kards can't take all the way to their goal, because a step on the way has no kard cost. */
  stuck?: string[];
}

export interface Ctx {
  state: AppState;
  rules: Map<string, RarityRule>;
  cards: Map<string, Card>;
  /** Copies that allocated Fusion Up Kards will supply, per card. */
  kardCopies: Map<string, number>;
  kardPlan: Map<string, KardPlan>;
}

/**
 * Every card is worth maxing; guest cards count extra because they're only around during their event. Kameos
 * count less, so shared currencies (Blood Rubies) go to gear first and Kameos once the gear is done. Challenge
 * Kameos count less again: finishing their Elder challenge gives one for sure.
 */
export function cardWeight(state: AppState, card: Card) {
  const w = state.weights;
  const kind = state.rarities.find((r) => r.id === card.rarityId)?.kind;
  return (card.guest ? w.guest : 1) * (kind === 'kameo' ? w.kameo : 1) * (card.source === 'challenge' ? w.challenge : 1);
}

/** Realm Klash gear: a fixed set of Epic pieces sold only for Blood Rubies. No more are being added. */
const REALM_KLASH_GEAR = ['Bloody Shokan Armor', 'Bloody Tomahawk', 'Bloody Voodoo Doll', 'Datusha, Bane of the Moroi', 'Devastator', "Blaze's Life Force", "Moloch's Ball and Chain", 'Shadow Sash', "Shang Tsung's Stone", "Sindel's Signet Ring"];
const REALM_KLASH_KEYS = new Set(REALM_KLASH_GEAR.map(nameKey));
// The planner asks this for every card many times per plan, so remember each name's answer.
const realmKlashByName = new Map<string, boolean>();
/** Whether a name is on the Realm Klash list (case, word order and apostrophes don't matter). */
export function isRealmKlashName(name: string) {
  let on = realmKlashByName.get(name);
  if (on === undefined) realmKlashByName.set(name, (on = REALM_KLASH_KEYS.has(nameKey(name))));
  return on;
}

/**
 * Realm Klash gear: equipment on the fixed REALM_KLASH_GEAR list, matched by name. It's maxed with Blood Rubies,
 * which come in daily, so Fusion Up Kards (much harder to get) are never spent on it and Kaskets never give it. Only the
 * name counts, not the card's goal or its store items. Clear expired keeps a piece's latest store item only so next
 * season's Rerun can copy it (see keepWhenExpired).
 */
export function isRealmKlashGear(state: AppState, card: Card) {
  return state.rarities.find((r) => r.id === card.rarityId)?.kind === 'equipment' && isRealmKlashName(card.name);
}

/**
 * Whether Clear expired keeps this pack: the latest run of a Blood Ruby store item for Realm Klash gear you still have.
 * Next season's Rerun copies its drops and Store item setting from the latest run with the same name (lastRun in
 * events.ts), and Blood Rubies only buy gear through store items, so deleting it would stop the plan buying the piece;
 * older runs aren't needed. Maxed cards are deleted, so the item clears once its piece is done.
 */
export function keepWhenExpired(state: AppState, pack: Pack) {
  const isItem = (p: Pack) => !!p.store && p.currencyId === REALM_KLASH_CURRENCY;
  if (!isItem(pack)) return false;
  const name = nameKey(pack.name);
  // A store item with no end date is still running, so it's newer than any expired run. Dates are compared as times,
  // since saves can hold them in different formats; on the same end date, the one saved later counts as newer.
  const end = (p: Pack) => (p.endsAt ? new Date(p.endsAt).getTime() : Infinity);
  const index = (p: Pack) => state.packs.findIndex((q) => q.id === p.id);
  const newer = (p: Pack) => end(p) > end(pack) || (end(p) === end(pack) && index(p) > index(pack));
  return pack.drops.some((d) => {
    const card = state.cards.find((c) => c.id === d.cardId);
    if (!card || !isRealmKlashGear(state, card)) return false;
    const later = (p: Pack) => p.id !== pack.id && isItem(p) && nameKey(p.name) === name && p.drops.some((x) => x.cardId === d.cardId) && newer(p);
    return !state.packs.some(later);
  });
}

/** Fusion Up Kards needed to go from stored level `level` to the next one, or null if kards can't do that step. */
export function kardCost(rule: RarityRule, level: number): number | null {
  const f = level - 1; // step index: F3→F4 is 3, and past fusionMax it's ascension (F10→A1 is 10)
  if (rule.fusionUpThreshold == null || f < rule.fusionUpThreshold || level >= maxFusion(rule)) return null;
  const cost = rule.kardsPerLevel?.[f];
  return cost && cost > 0 ? cost : null;
}

/**
 * Spend each rarity's Fusion Up Kards one fusion step at a time. Costs rise steeply (a Diamond's F9→F10 costs
 * 10 kards, F3→F4 costs 1), and every step saves one pack copy, so the next kard always goes to the cheapest
 * step available, weighted up for guest cards. Ties go to the card with the fewest steps left to its goal, so a
 * card gets finished before another is started (opening a Gold ascension also takes Ascension Kards, untracked).
 * Kards work from the threshold (F3) up, through fusion and on into Gold ascension. Realm Klash gear gets none, nor
 * does a card marked No kards.
 * Gear is different: its special effect only comes at its goal (F10), so a part-fused piece is worth nothing
 * extra. Its kards finish one piece at a time, the one needing fewest kards first, and what's left waits for the
 * next piece rather than going part of the way.
 */
function allocateKards(state: AppState) {
  const kardCopies = new Map<string, number>();
  const kardPlan = new Map<string, KardPlan>();
  for (const rule of state.rarities) {
    const thr = thresholdLevel(rule);
    // Only a rarity tracked to max has a kard box, so kards left saved on one tracked to F3 stay unplanned.
    if (thr == null || rule.goal !== 'max' || rule.fusionUpKards <= 0) continue;
    const cap = (c: Card) => targetLevel(c, rule);
    const open = state.cards.filter((c) => c.rarityId === rule.id && c.fusion >= thr && c.fusion < cap(c));
    const realmKlash = open.filter((c) => isRealmKlashGear(state, c)).length;
    const cards = open.filter((c) => !isRealmKlashGear(state, c) && !c.noKards);
    const noKards = open.length - realmKlash - cards.length;
    const costs = cards.map((c) => kardCost(rule, c.fusion)).filter((k): k is number => k != null);
    const level = new Map(cards.map((c) => [c.id, c.fusion]));
    const spent = new Map<string, number>();
    const stepsLeft = (c: Card) => cap(c) - level.get(c.id)!;
    const closer = (a: Card, b: Card) => stepsLeft(a) < stepsLeft(b) || (stepsLeft(a) === stepsLeft(b) && level.get(a.id)! > level.get(b.id)!);
    let left = rule.fusionUpKards;
    let next: KardPlan['next'];
    let stuck: string[] = [];
    const finishOrder = new Map<string, number>();
    if (rule.kind === 'equipment') {
      // Kards to take a piece all the way to its goal; null when a step on the way can't be done with kards.
      const finishCost = (c: Card) => {
        let k = 0;
        for (let lvl = c.fusion; lvl < cap(c); lvl++) {
          const step = kardCost(rule, lvl);
          if (step == null) return null;
          k += step;
        }
        return k;
      };
      const all = cards.map((card) => ({ card, cost: finishCost(card) }));
      stuck = all.filter((x) => x.cost == null).map((x) => x.card.id);
      const queue = all
        .filter((x): x is { card: Card; cost: number } => x.cost != null)
        .sort((a, b) => a.cost - b.cost || b.card.fusion - a.card.fusion || a.card.name.localeCompare(b.card.name));
      for (const { card, cost } of queue) {
        // Sorted cheapest first, so once one piece is out of reach every later one is too.
        if (cost > left) {
          next = { cardId: card.id, needs: cost };
          break;
        }
        level.set(card.id, cap(card));
        spent.set(card.id, cost);
        finishOrder.set(card.id, finishOrder.size);
        left -= cost;
      }
    } else for (;;) {
      let best: { card: Card; cost: number; score: number } | null = null;
      for (const c of cards) {
        const lvl = level.get(c.id)!;
        if (lvl >= cap(c)) continue;
        const cost = kardCost(rule, lvl);
        if (cost == null || cost > left) continue;
        const score = cardWeight(state, c) / cost;
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && closer(c, best.card))) best = { card: c, cost, score };
      }
      if (!best) break;
      level.set(best.card.id, level.get(best.card.id)! + 1);
      spent.set(best.card.id, (spent.get(best.card.id) ?? 0) + best.cost);
      left -= best.cost;
    }
    const assignments: KardAssignment[] = [];
    for (const c of cards) {
      const to = level.get(c.id)!;
      if (to === c.fusion) continue;
      assignments.push({ cardId: c.id, from: c.fusion, to, kards: spent.get(c.id)! });
      kardCopies.set(c.id, copiesAtFusion(rule, to) - copiesAtFusion(rule, c.fusion));
    }
    // Gear rows follow the finishing order (fewest kards first), so the top row is the piece to fuse first.
    if (rule.kind === 'equipment') assignments.sort((a, b) => finishOrder.get(a.cardId)! - finishOrder.get(b.cardId)!);
    else assignments.sort((a, b) => b.to - a.to || b.kards - a.kards);
    kardPlan.set(rule.id, { assignments, left, cards: cards.length, cheapest: costs.length ? Math.min(...costs) : null, realmKlash, ...(noKards > 0 && { noKards }), ...(next && { next }), ...(stuck.length > 0 && { stuck }) });
  }
  return { kardCopies, kardPlan };
}

export function buildCtx(state: AppState): Ctx {
  const rules = new Map(state.rarities.map((r) => [r.id, r]));
  const cards = new Map(state.cards.map((c) => [c.id, c]));
  return { state, rules, cards, ...allocateKards(state) };
}

// ---------- Value of a copy ----------

export type Phase = 'unlock' | 'toThreshold' | 'noKards' | 'normal' | 'kardCovered' | 'maxed' | 'skip';

/** Which phase the copy at position `g` (copies already gained beyond current) falls into. */
export function copyPhase(ctx: Ctx, card: Card, g = 0): Phase {
  const rule = ctx.rules.get(card.rarityId);
  if (!rule) return 'skip';
  const remaining = copiesToMax(card, rule);
  if (g >= remaining) return 'maxed';
  const pos = copiesAtFusion(rule, card.fusion) + g;
  if (pos < 1) return 'unlock';
  const thr = thresholdLevel(rule);
  // Kards can't stand in for any copy of a card that can't take them, so every copy to its max is valued like those
  // to the threshold: packs are the only way to get it. Not Realm Klash gear, bought with Blood Rubies, whatever a
  // flag left on it says.
  if (thr != null && card.noKards && !(rule.kind === 'equipment' && isRealmKlashName(card.name))) return 'noKards';
  if (thr != null && pos < copiesAtFusion(rule, thr)) return 'toThreshold';
  if (g >= remaining - (ctx.kardCopies.get(card.id) ?? 0)) return 'kardCovered';
  return 'normal';
}

function copyValue(ctx: Ctx, card: Card, g = 0): number {
  const phase = copyPhase(ctx, card, g);
  if (phase === 'skip' || phase === 'maxed') return 0;
  const w = ctx.state.weights;
  const rule = ctx.rules.get(card.rarityId)!;
  const mult = { unlock: w.unlock, toThreshold: w.belowThreshold, noKards: w.belowThreshold, kardCovered: w.coveredByKards, normal: 1 }[phase];
  const progress = (copiesAtFusion(rule, card.fusion) + g) / copiesAtFusion(rule, targetLevel(card, rule));
  return cardWeight(ctx.state, card) * mult * (1 + w.closenessBonus * progress);
}

/** Value of receiving `e` expected copies starting from `g` already gained (integrated across phase boundaries). */
function gainValue(ctx: Ctx, card: Card, g: number, e: number): number {
  const step = 0.05;
  let v = 0;
  for (let x = 0; x < e; x += step) {
    const d = Math.min(step, e - x);
    v += d * copyValue(ctx, card, g + x + d / 2);
  }
  return v;
}

// ---------- Packs ----------

export function packStatus(pack: Pack, now: Date): 'active' | 'upcoming' | 'expired' {
  if (pack.endsAt && new Date(pack.endsAt) < now) return 'expired';
  if (pack.startsAt && new Date(pack.startsAt) > now) return 'upcoming';
  return 'active';
}

const purchasesLeft = (pack: Pack) =>
  pack.maxPurchases == null ? Infinity : Math.max(0, pack.maxPurchases - pack.purchased);

/** Expected copies of a drop per purchase. */
const expectedCopies = (pack: Pack, chance: number) => pack.rolls * (chance / 100);

/** Chance of at least one copy of a drop per purchase. */
const chanceAtLeastOne = (pack: Pack, chance: number) => 1 - Math.pow(1 - chance / 100, pack.rolls);

/** A card a Kasket can give, with the copies it has (`owned`) and needs for its own max (`full`). */
interface KasketCard {
  card: Card;
  owned: number;
  full: number;
}

/**
 * Per ctx, each rarity's cards a Kasket can ever give, with their copy counts worked out once: the planner asks for
 * every Kasket on every pass, so the pool filters only compare numbers.
 */
const kasketCardsByCtx = new WeakMap<Ctx, Map<string, KasketCard[]>>();

function kasketCards(ctx: Ctx, rule: RarityRule): KasketCard[] {
  let byRarity = kasketCardsByCtx.get(ctx);
  if (!byRarity) kasketCardsByCtx.set(ctx, (byRarity = new Map()));
  let cards = byRarity.get(rule.id);
  if (!cards) {
    cards = ctx.state.cards
      // Realm Klash gear is only sold for Blood Rubies; Kaskets never give it.
      .filter((c) => c.rarityId === rule.id && !isKasketExcluded(c) && !isRealmKlashGear(ctx.state, c))
      .map((card) => ({ card, owned: copiesAtFusion(rule, card.fusion), full: copiesAtFusion(rule, targetLevel(card, rule)) }));
    byRarity.set(rule.id, cards);
  }
  return cards;
}

export interface KasketPool {
  /** 'new': cards you don't own; 'unmaxed': you own them all, so cards short of max; 'none': nothing it's valued for. */
  mode: 'new' | 'unmaxed' | 'none';
  cards: Card[];
  /** The rarity it draws from; undefined when that rarity has been removed. */
  rule?: RarityRule;
}

/**
 * The cards a Kasket can give: its rarity's cards you don't own, minus the newest ones (isKasketExcluded). Once you
 * own them all it gives cards short of max, but only for a rarity tracked to max: gear tracked to the kard threshold
 * has its F3+ pieces deleted, so the app can't see most of what it would give and values it at 0. `gained` is the
 * planner's expected copies so far: a card counts as owned once it's expected one copy, so after as many planned
 * buys as there are new cards, the next one gives an unmaxed card, as in the game.
 */
export function kasketPool(ctx: Ctx, pack: Pack, gained: Map<string, number> = new Map()): KasketPool {
  const rule = pack.kasket ? ctx.rules.get(pack.kasket) : undefined;
  if (!rule) return { mode: 'none', cards: [] };
  // Kaskets give characters or gear; a Kameo rarity can only get here from an import, and isn't valued.
  if (rule.kind === 'kameo') return { mode: 'none', cards: [], rule };
  const copies = (k: KasketCard) => k.owned + (gained.get(k.card.id) ?? 0);
  const eligible = kasketCards(ctx, rule);
  const unowned = eligible.filter((k) => copies(k) < 1 - 1e-9).map((k) => k.card);
  if (unowned.length) return { mode: 'new', cards: unowned, rule };
  const unmaxed = rule.goal === 'max' ? eligible.filter((k) => copies(k) < k.full - 1e-9).map((k) => k.card) : [];
  return { mode: unmaxed.length ? 'unmaxed' : 'none', cards: unmaxed, rule };
}

/** A pack's drops: its saved list, or for a Kasket an even share of its current pool (one card per purchase). */
export function packDrops(ctx: Ctx, pack: Pack, gained?: Map<string, number>): DropEntry[] {
  if (!pack.kasket) return pack.drops;
  const { cards } = kasketPool(ctx, pack, gained);
  return cards.map((c) => ({ cardId: c.id, chance: 100 / cards.length }));
}

/**
 * What a Kasket's pull search offers: every card of its rarity (`exclude` holds the rest), with the ones it can give
 * right now `first`. The others stay findable because the model can be wrong, say the newest-cards list going stale
 * at an update, and a pull you can't find can't be logged from the pack. With its rarity removed it offers every card.
 */
export function kasketPullCards(ctx: Ctx, pack: Pack) {
  const pool = kasketPool(ctx, pack);
  const rarityId = pool.rule?.id;
  return {
    exclude: new Set(rarityId ? ctx.state.cards.filter((c) => c.rarityId !== rarityId).map((c) => c.id) : []),
    first: new Set(pool.cards.map((c) => c.id)),
  };
}

/**
 * A pack as a Kasket is kept: one card per purchase, no drops or store item of its own (its pool comes from the
 * cards). An empty or null `kasket` means it isn't one: the editor uses '' while no rarity is chosen, and an import
 * or synced save can carry null, since JSON has no undefined. Without this the planner would value such a pack by
 * drops the screen hides. A pack marked both a store item and a Kasket (the editor never does this, only a
 * hand-edited import) stays a store item when it has a drop, since a Realm Klash piece's store item is what Blood
 * Rubies buy it through; with no drops it stays a Kasket, which is worth something, rather than a store item of nothing.
 */
export function kasketShape(pack: Pack): Pack {
  if (typeof pack.kasket !== 'string' || !pack.kasket || (pack.store && pack.drops.length > 0)) {
    if (!('kasket' in pack)) return pack;
    const out = { ...pack };
    delete out.kasket;
    return out;
  }
  if (!pack.store && pack.rolls === 1 && pack.drops.length === 0) return pack;
  const out = { ...pack, rolls: 1, drops: [] };
  delete out.store;
  return out;
}

/** Remove a rarity and the Kaskets that draw from it, in one change so one Undo brings both back. Mutates the state. */
export function removeRarity(d: AppState, id: string) {
  d.rarities = d.rarities.filter((r) => r.id !== id);
  d.packs = d.packs.filter((p) => p.kasket !== id);
}

export function packEV(ctx: Ctx, pack: Pack, gained: Map<string, number> = new Map()): number {
  let v = 0;
  for (const d of packDrops(ctx, pack, gained)) {
    const card = ctx.cards.get(d.cardId);
    if (!card) continue;
    v += gainValue(ctx, card, gained.get(card.id) ?? 0, expectedCopies(pack, d.chance));
  }
  return v;
}

export interface PackRank {
  pack: Pack;
  status: 'active' | 'upcoming';
  ev: number;
  /** EV per 1000 currency. */
  evPerK: number;
  /**
   * `withinBuys`: a Kasket giving new cards never repeats one, so each card in its pool of N comes within N buys;
   * buysPerCopy (which assumes repeats) would overstate it. Left out when its purchase limit has fewer buys left.
   * `once`: the card comes from a Kasket of new cards, which gives it only once, so even a sure chance isn't "every buy".
   */
  targets: { card: Card; value: number; pAtLeastOne: number; buysPerCopy: number; withinBuys?: number; once?: true }[];
}

export function rankPacks(ctx: Ctx, now: Date): PackRank[] {
  return ctx.state.packs
    .map((pack) => ({ pack, status: packStatus(pack, now) }))
    .filter((x): x is { pack: Pack; status: 'active' | 'upcoming' } => x.status !== 'expired')
    .map(({ pack, status }) => {
      const ev = packEV(ctx, pack);
      const pool = pack.kasket ? kasketPool(ctx, pack) : undefined;
      const withinBuys = pool?.mode === 'new' && pool.cards.length <= purchasesLeft(pack) ? pool.cards.length : undefined;
      const targets = packDrops(ctx, pack)
        .map((d) => {
          const card = ctx.cards.get(d.cardId);
          if (!card) return null;
          const e = expectedCopies(pack, d.chance);
          return { card, value: gainValue(ctx, card, 0, e), pAtLeastOne: chanceAtLeastOne(pack, d.chance), buysPerCopy: e > 0 ? 1 / e : Infinity, ...(withinBuys && { withinBuys }), ...(pool?.mode === 'new' && { once: true as const }) };
        })
        .filter((t): t is NonNullable<typeof t> => t != null && t.value > 0)
        .sort((a, b) => b.value - a.value);
      return { pack, status, ev, evPerK: pack.cost > 0 ? (ev / pack.cost) * 1000 : 0, targets };
    })
    .sort((a, b) => b.evPerK - a.evPerK);
}

// ---------- Budget planner ----------

interface PlannedBuy {
  pack: Pack;
  status: 'active' | 'upcoming';
  count: number;
  totalCost: number;
  ev: number;
  /** Bought in the gear-first step (Realm Klash gear, maxed one piece at a time before anything else). */
  gear?: boolean;
}

export interface CurrencyPlan {
  currencyId: string;
  startBalance: number;
  spent: number;
  buys: PlannedBuy[];
  /** Best pack you couldn't afford another purchase of; `gear` when it's the next Realm Klash gear, which blocks packs. */
  saveFor?: { pack: Pack; shortBy: number; gear?: boolean };
}

export interface Plan {
  currencies: CurrencyPlan[];
  /** Expected copies gained per card if you follow the plan. */
  expectedGains: Map<string, number>;
}

/** Blood Ruby gear order for gear that isn't in the saved order yet, matched like REALM_KLASH_GEAR. */
const DEFAULT_GEAR_ORDER = ['Shadow Sash', "Moloch's Ball and Chain", 'Devastator', 'Datusha, Bane of the Moroi', 'Bloody Tomahawk'].map(nameKey);

export interface GearStep {
  card: Card;
  /** Its Blood Ruby store items that haven't expired. */
  items: Pack[];
  /** Copies still to buy to its goal; no Fusion Up Kards go to this gear. */
  need: number;
}

/**
 * Realm Klash gear with an active Blood Ruby store item, in buying order: the saved order first, then DEFAULT_GEAR_ORDER,
 * then by name. Only listed pieces, so gear that gets kards is never also bought with rubies.
 */
export function gearQueue(ctx: Ctx, now: Date): GearStep[] {
  const items = ctx.state.packs.filter((p) => p.store && p.currencyId === REALM_KLASH_CURRENCY && p.cost > 0 && packStatus(p, now) !== 'expired');
  const byOrder = gearOrderCompare(ctx.state);
  return ctx.state.cards
    .filter((c) => isRealmKlashGear(ctx.state, c))
    .map((card) => {
      const rule = ctx.rules.get(card.rarityId)!;
      return {
        card,
        items: items.filter((p) => p.drops.some((d) => d.cardId === card.id)),
        need: copiesToMax(card, rule),
      };
    })
    .filter((g) => g.items.length > 0 && g.need > 0)
    .sort((a, b) => byOrder(a.card, b.card));
}

/**
 * Sorts Realm Klash pieces into the buying order: each piece's saved place, else its default place after every saved
 * one, then by name. The gear queue, the "Not on sale now" line and the ↑/↓ move (moveInGearOrder) all use it, so they always agree.
 */
function gearOrderCompare(state: AppState) {
  const saved = state.gearOrder ?? [];
  const rank = (c: Card) => {
    const i = saved.indexOf(c.id);
    if (i >= 0) return i;
    const d = DEFAULT_GEAR_ORDER.indexOf(nameKey(c.name));
    return d >= 0 ? saved.length + d : Infinity;
  };
  return (a: Card, b: Card) => rank(a) - rank(b) || a.name.localeCompare(b.name);
}

/**
 * The gear order to save after moving piece `id` up (-1) or down (1) past its on-sale neighbour `past` (Settings' ↑/↓),
 * or null when there's nothing to move. Every Realm Klash piece is saved in its place, on sale or not, and only the
 * tapped piece moves: the two aren't swapped, since pieces waiting for their store item can sit between them, and
 * swapping would push the other one past those too. `onSale` is the pieces on sale now, in buying order (gearQueue):
 * when given, the tapped piece must still be on sale and `past` still the next one in the arrow's direction.
 */
export function moveInGearOrder(state: AppState, id: string, past: string, by: -1 | 1, onSale?: string[]): string[] | null {
  const ids = state.cards
    .filter((c) => isRealmKlashGear(state, c))
    .sort(gearOrderCompare(state))
    .map((c) => c.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(past);
  // Already on the side the arrow points to: the order changed (a sync) after the screen showed it. Moving by where
  // the pieces sit now would send the piece back over its neighbour and undo the last move.
  if (from < 0 || to < 0 || id === past || (by > 0) !== (from < to)) return null;
  // A sync took the tapped piece off sale (it keeps its place), or put another piece on sale between the two since the
  // screen was drawn (moving would jump that one too).
  if (onSale) {
    const at = onSale.indexOf(id);
    if (at < 0 || onSale[at + by] !== past) return null;
  }
  ids.splice(from, 1);
  const at = ids.indexOf(past);
  ids.splice(by > 0 ? at + 1 : at, 0, id);
  return [...ids, ...(state.gearOrder ?? []).filter((x) => !ids.includes(x))];
}

/**
 * Realm Klash gear still to max that no Blood Ruby store item on sale now sells: nothing plans it (no kards, no
 * rubies) until the shop has it again, in the buying order it goes back to. Takes gearQueue's result, which callers already have.
 */
export function gearWaiting(ctx: Ctx, queue: GearStep[]): Card[] {
  const queued = new Set(queue.map((g) => g.card.id));
  return ctx.state.cards.filter((c) => isRealmKlashGear(ctx.state, c) && !queued.has(c.id)).sort(gearOrderCompare(ctx.state));
}

/**
 * Blood Rubies max the Realm Klash gear first, one piece at a time in gearQueue order; nothing else is bought
 * until every piece is done or out of purchases. Then, for every currency, greedy: repeatedly buy the
 * affordable pack with the best (marginal EV / cost), updating expected card progress after each buy so later
 * buys see diminishing returns. Currencies are budgeted independently but share card progress.
 */
export function buildPlan(ctx: Ctx, now: Date): Plan {
  const gained = new Map<string, number>();
  const boost = ctx.state.weights.limitedBoost;
  const available = ctx.state.packs
    .map((pack) => ({ pack, status: packStatus(pack, now) }))
    .filter((x): x is { pack: Pack; status: 'active' | 'upcoming' } => x.status !== 'expired' && x.pack.cost > 0);

  const currencies: CurrencyPlan[] = ctx.state.currencies.map((cur) => {
    const packs = available.filter((x) => x.pack.currencyId === cur.id);
    const bought = new Map<string, number>();
    const buyEv = new Map<string, number>();
    // Below 0 only after logging a buy the typed balance didn't cover (see recordPurchase): there's nothing to spend.
    const balance = Math.max(0, cur.balance);
    let budget = balance;
    const score = (p: Pack) => (packEV(ctx, p, gained) / p.cost) * (p.endsAt ? boost : 1);
    const buy = (p: Pack) => {
      buyEv.set(p.id, (buyEv.get(p.id) ?? 0) + packEV(ctx, p, gained));
      // A Kasket's pool depends on what's gained so far, so it's worked out before this buy's copies are added.
      for (const d of packDrops(ctx, p, gained)) gained.set(d.cardId, (gained.get(d.cardId) ?? 0) + expectedCopies(p, d.chance));
      bought.set(p.id, (bought.get(p.id) ?? 0) + 1);
      budget -= p.cost;
    };
    const canBuyMore = (p: Pack) => (bought.get(p.id) ?? 0) < purchasesLeft(p);

    let saveFor: CurrencyPlan['saveFor'];
    const gearOrder: string[] = [];
    if (cur.id === REALM_KLASH_CURRENCY) {
      gear: for (const step of gearQueue(ctx, now)) {
        const copies = (p: Pack) => expectedCopies(p, p.drops.find((d) => d.cardId === step.card.id)!.chance);
        while ((gained.get(step.card.id) ?? 0) < step.need - 1e-9) {
          // Cheapest copy among its store items that still have purchases left; none left → on to the next piece.
          const item = step.items.filter(canBuyMore).sort((a, b) => a.cost / copies(a) - b.cost / copies(b))[0];
          if (!item) break;
          if (item.cost > budget) {
            saveFor = { pack: item, shortBy: item.cost - budget, gear: true };
            break gear;
          }
          if (!gearOrder.includes(item.id)) gearOrder.push(item.id);
          buy(item);
        }
      }
    }

    if (!saveFor) {
      for (let guard = 0; guard < 1000; guard++) {
        let best: Pack | null = null;
        let bestScore = 0;
        for (const { pack } of packs) {
          if (pack.cost > budget || !canBuyMore(pack)) continue;
          const s = score(pack);
          if (s > bestScore + 1e-12) {
            best = pack;
            bestScore = s;
          }
        }
        if (!best) break;
        buy(best);
      }

      let saveScore = 0;
      for (const { pack } of packs) {
        if (pack.cost <= budget || !canBuyMore(pack)) continue;
        const s = score(pack);
        if (s > saveScore) {
          saveScore = s;
          saveFor = { pack, shortBy: pack.cost - budget };
        }
      }
    }

    // Gear in the order it's bought, then limited-time packs soonest-ending first.
    const gearRank = (p: Pack) => (gearOrder.includes(p.id) ? gearOrder.indexOf(p.id) : Infinity);
    const buys = packs
      .filter(({ pack }) => bought.has(pack.id))
      .map(({ pack, status }) => ({
        pack, status, count: bought.get(pack.id)!, totalCost: bought.get(pack.id)! * pack.cost, ev: buyEv.get(pack.id)!, gear: gearOrder.includes(pack.id),
      }))
      .sort((a, b) => gearRank(a.pack) - gearRank(b.pack) || urgency(a.pack) - urgency(b.pack));

    return { currencyId: cur.id, startBalance: balance, spent: balance - budget, buys, saveFor };
  });

  return { currencies, expectedGains: gained };
}

/** Whole days until `shortBy` more comes in at `perDay` a day; null when the currency has no daily income set. */
export function daysToAfford(shortBy: number, perDay: number | undefined) {
  return perDay && perDay > 0 ? Math.ceil(shortBy / perDay) : null;
}

/**
 * When each Realm Klash gear piece would be maxed, buying in gear order with today's balance plus `perDay` a
 * day: the rubies spent up to and including that piece, and the whole days until they're in (0 = affordable
 * now). Null days without a daily income. Rewards that land later only bring the dates closer.
 */
export function gearForecast(gear: GearStep[], balance: number, perDay: number | undefined) {
  balance = Math.max(0, balance);
  let total = 0;
  return gear.map((g) => {
    total += g.need * Math.min(...g.items.map((p) => p.cost));
    return { cardId: g.card.id, total, days: total <= balance ? 0 : daysToAfford(total - balance, perDay) };
  });
}

/** How close to its end a planned pack counts as ending soon. */
const ENDING_SOON_MS = 24 * 3600000;

/** Packs the plan says to buy now that end within ENDING_SOON_MS. */
export function endingSoon(plan: Plan, now: Date): Pack[] {
  return plan.currencies.flatMap((c) =>
    c.buys
      .filter((b) => b.status === 'active' && b.pack.endsAt)
      .map((b) => b.pack)
      .filter((p) => {
        const left = new Date(p.endsAt!).getTime() - now.getTime();
        return left > 0 && left <= ENDING_SOON_MS;
      }),
  );
}

// ---------- Recording purchases ----------

/** Level a card up or down by one copy, within its rarity's range. Returns whether its level changed. */
export function stepCard(d: AppState, cardId: string, delta: 1 | -1) {
  const card = d.cards.find((c) => c.id === cardId);
  const rule = card && d.rarities.find((r) => r.id === card.rarityId);
  if (!card || !rule) return false;
  const was = card.fusion;
  card.fusion = Math.min(maxFusion(rule), Math.max(0, card.fusion + delta));
  return card.fusion !== was;
}

/**
 * The Fusion Up Kards this card's next step would take from the Wallet now, or null when kards can't do it: below
 * the threshold (F3), already at its goal, Realm Klash gear (bought to max, never kards), a card marked No kards, a
 * rarity not tracked to max (it has no kard box), a step with no kard cost, or more kards than the Wallet holds.
 */
export function kardStep(state: AppState, cardId: string): number | null {
  const card = state.cards.find((c) => c.id === cardId);
  const rule = card && state.rarities.find((r) => r.id === card.rarityId);
  if (!card || !rule || rule.goal !== 'max' || card.noKards || card.fusion >= targetLevel(card, rule) || isRealmKlashGear(state, card)) return null;
  const cost = kardCost(rule, card.fusion);
  return cost != null && cost <= rule.fusionUpKards ? cost : null;
}

/**
 * Fuse a card one step with Fusion Up Kards, as done in the game: the kards come off the Wallet and the card goes
 * up a level. Returns the kards used, or null when kardStep says the step isn't possible, or the step isn't the one
 * the button showed: a different cost than the `expected` kards, or a card no longer at level `from` (a sync already
 * made the step, and the next may cost the same). Ascension steps also take Ascension Kards in the game, which aren't
 * tracked.
 */
export function fuseWithKards(d: AppState, cardId: string, expected?: number, from?: number): number | null {
  const cost = kardStep(d, cardId);
  const card = d.cards.find((c) => c.id === cardId);
  const rule = card && d.rarities.find((r) => r.id === card.rarityId);
  if (cost == null || !card || !rule || (expected != null && cost !== expected) || (from != null && card.fusion !== from)) return null;
  rule.fusionUpKards -= cost;
  card.fusion += 1;
  return cost;
}

/**
 * Buy (delta 1) or take back (delta -1) one purchase of a pack: counts it, moves the cost out of (or back into)
 * the balance, and for a store item, which always gives its card, levels that card. Random packs leave the
 * cards to the "What did you pull?" step. Returns false when nothing was logged: the pack is gone, a +1 would pass
 * its purchase limit, or a −1 has no purchase left to take back.
 *
 * A buy the balance doesn't cover takes it below 0 rather than stopping at 0: the typed balance was out of date,
 * and -1 (for a mis-tap) has to give back exactly what the buy took. The planner counts a negative balance as 0.
 */
export function recordPurchase(d: AppState, packId: string, delta: 1 | -1) {
  const pack = d.packs.find((x) => x.id === packId);
  if (!pack || (delta < 0 && pack.purchased <= 0)) return false;
  if (delta > 0 && pack.maxPurchases != null && pack.purchased >= pack.maxPurchases) return false;
  pack.purchased += delta;
  const cur = d.currencies.find((c) => c.id === pack.currencyId);
  if (cur) cur.balance -= delta * pack.cost;
  if (pack.store && pack.drops[0]) stepCard(d, pack.drops[0].cardId, delta);
  return true;
}

// ---------- Realm Klash seasons ----------

/** The Blood Ruby store's currency; its characters, Kameos and Kameo packs change every season. */
export const REALM_KLASH_CURRENCY = 'blood-rubies';
const SEASON_DAYS = 14;

/** A Date as a datetime-local string (local time, minutes). */
export function toLocalInput(t: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/**
 * The current season's end: the saved end, moved forward 2 weeks at a time until it's in the future, since
 * seasons run back to back. Null if no season end was ever entered.
 */
export function seasonEnd(saved: string | null | undefined, now: Date): string | null {
  if (!saved) return null;
  const t = new Date(saved);
  if (isNaN(t.getTime())) return null;
  while (t <= now) t.setDate(t.getDate() + SEASON_DAYS); // setDate keeps the local time across DST changes
  return toLocalInput(t);
}

/**
 * The changeovers the saved season end has already rolled through (itself, then every 2 weeks, up to now) that the
 * schedule lists as earlier week ends of the current season: the season was stretched after they passed, so items
 * still ending on them belong to the season that's still on. The saved end is usually a season or more back (it's only
 * rewritten when the date changes), so checking the saved end alone misses most stretched seasons. Latest first.
 */
export function stretchedWeekEnds(saved: string | null | undefined, now: Date, weekEnds?: string[]): string[] {
  if (!saved || !weekEnds?.length) return [];
  const t = new Date(saved);
  if (isNaN(t.getTime())) return [];
  const ends = weekEnds.map((w) => [w, new Date(w).getTime()] as const);
  // A saved end long ago (or with a mistyped year) would take many 2-week steps to roll forward: skip to a season
  // before the earliest week end. setDate keeps the local time across clock changes.
  const span = SEASON_DAYS * 24 * 3600_000;
  const steps = Math.floor((Math.min(...ends.map(([, e]) => e)) - t.getTime()) / span) - 1;
  if (steps > 0) t.setDate(t.getDate() + steps * SEASON_DAYS);
  // The rolled end keeps its local time while the schedule's week ends are fixed instants 2 weeks apart, so after a
  // clock change since the saved end they're off by exactly that change: both spellings count, since items may end on
  // either. Nothing else does: a date typed by hand, or set with Ended early, a little after the real changeover
  // belongs to the season before.
  const savedOffset = new Date(saved).getTimezoneOffset();
  const found = new Set<string>();
  for (; t <= now; t.setDate(t.getDate() + SEASON_DAYS)) {
    const at = t.getTime();
    const grid = at + (savedOffset - t.getTimezoneOffset()) * 60_000;
    const near = ends.filter(([, e]) => e === at || e === grid);
    if (near.length) [toLocalInput(t), ...near.map(([w]) => w)].forEach((c) => found.add(c));
  }
  return [...found].sort().reverse();
}

/**
 * Change the current season's end (a corrected timer, or a season that ended early). Every seasonal pack that
 * was ending with it moves too; packs from earlier seasons keep their dates. Mutates the state, and returns whether
 * anything moved: false when the current season end (the saved one rolled forward, see seasonEnd) is already `to`
 * and none of the season's earlier week ends need moving (see stretchedWeekEnds).
 *
 * An item entered ahead for a later season (see packEndOnSave) starts once the season it was saved against is over,
 * so it moves with that changeover to stay in the season it starts in, and its end becomes the 2-week guess from the
 * new changeover. Left on its old date it would expire while still in the store, and no later move would find it.
 * Any end counts, not just the 2-week guess, since the schedule may have dated its season. One that starts right at
 * the changeover opens the next season, so it starts at the new one.
 *
 * `weekEnds` are the current season's earlier week ends, when the schedule knows them. The schedule can add a week
 * to a season after the saved end has passed, and that season's items still end on the saved date rather than the
 * 2-week guess, so items ending on one of those week ends (the saved end, or a 2-week changeover it rolled through)
 * move too. Only a week end counts, give or take a clock change (see stretchedWeekEnds): a date typed by hand, or set
 * with Ended early, a little after the real changeover belongs to the season before. An item starting on or after
 * one of those week ends is on sale in the season that's still on (store items only show up once they're in the
 * store), so it keeps its start.
 */
export function moveSeasonEnd(s: AppState, to: string, now: Date, weekEnds?: string[]) {
  const from = seasonEnd(s.realmKlashSeasonEnd, now);
  const extended = stretchedWeekEnds(s.realmKlashSeasonEnd, now, weekEnds);
  // Already there (often a pull brought the move in from another device): nothing to move. Unless the schedule
  // stretched the season by exactly 2 weeks: the saved end rolled forward is then the new end, but items still ending
  // on one of the season's earlier week ends have to move.
  if (from === to && !extended.length) return false;
  // When `to` is the current end, that changeover isn't moving: only the earlier week ends do, and items starting at
  // or after `to` (the next season's) keep their dates.
  const still = from === to;
  const changeovers = [...(still ? [] : [from]), ...extended].filter((c): c is string => !!c);
  let moved = false;
  for (const p of s.packs) {
    if (!p.season || !p.endsAt) continue;
    const start = p.startsAt;
    // An item already starting at `to` (or, when `to` isn't moving, after it) is in the season it belongs to, with its own
    // end from the schedule: neither its start nor its end moves.
    if (start && (still ? start >= to : start === to)) {
      // Unless its end was the current season's, written in when it was entered ahead (packEndOnSave): it then takes
      // the 2-week guess from its start, as a re-save would give it.
      if (!still && changeovers.includes(p.endsAt)) p.endsAt = seasonEnd(to, new Date(start));
      continue;
    }
    // Only the current end, when it moves, has items entered ahead past it. A stretched week end has passed while the
    // season went on, so an item starting there is on sale now: it keeps its start, and ends with the season.
    if (!still && from && start && start >= from) {
      if (start === from) p.startsAt = to;
      p.endsAt = seasonEnd(to, new Date(p.startsAt!));
    } else if (changeovers.includes(p.endsAt)) {
      p.endsAt = to;
      moved = true;
    }
  }
  // When the end isn't moving and no item was on a stretched week end, there's nothing to save: rewriting the saved end
  // (it already rolls forward to `to`) would only make every device save, and ask which copy to keep. Leaving it also
  // lets an item on that week end that syncs in later still be found.
  if (still && !moved) return false;
  s.realmKlashSeasonEnd = to;
  return true;
}

/** Whether a pack rotates with the season when the user hasn't said: Blood Ruby items that aren't gear. */
export function suggestSeason(pack: Pack, state: AppState) {
  if (pack.currencyId !== REALM_KLASH_CURRENCY) return false;
  const card = pack.store && state.cards.find((c) => c.id === pack.drops[0]?.cardId);
  return !(card && state.rarities.find((r) => r.id === card.rarityId)?.kind === 'equipment');
}

/** Whether a pack leaves with the Realm Klash season: as the user set it, or else as suggestSeason guesses. */
export const isSeasonal = (pack: Pack, state: AppState) => pack.currencyId === REALM_KLASH_CURRENCY && (pack.season ?? suggestSeason(pack, state));

/** A seasonal pack from a season that has already ended, which keeps its own date rather than the current season's. */
export const fromEndedSeason = (pack: Pack, currentEnd: string | null, now: Date) => !!pack.endsAt && pack.endsAt !== currentEnd && new Date(pack.endsAt) <= now;

// ---------- Saving a pack from the editor ----------

/**
 * The pack the editor saves: its draft laid over the pack as it is now (`live`, undefined for a pack that isn't saved
 * yet). The editor works on a copy taken when it opened, and a purchase or a season move can land while it's open (on
 * this device, or synced from another), so Already bought and the end date keep their current values unless they
 * were `changed` in the editor.
 */
export function editedPack(draft: Pack, live: Pack | undefined, changed: { purchased?: boolean; endsAt?: boolean }): Pack {
  if (!live) return draft;
  return { ...draft, purchased: changed.purchased ? draft.purchased : live.purchased, endsAt: changed.endsAt ? draft.endsAt : live.endsAt };
}

/**
 * The end date a pack is saved with. A seasonal pack ends with the current season (`currentEnd`), except one from a
 * season that has already ended, which keeps its date, and one that starts once the current season is over, which
 * ends with the season it starts in (`startSeason`, from scheduledSeason, when the schedule lists it). That's the
 * schedule's end when a different season is listed after it, and otherwise 2 weeks at a time, or the schedule's end
 * if that's later: the site lists only the next week, so a season that starts next week shows as one week long. Other
 * packs, and seasonal ones before any season end is known, keep their own end.
 */
export function packEndOnSave(pack: Pack, seasonal: boolean, currentEnd: string | null, now: Date, startSeason?: { end: string; complete: boolean } | null) {
  if (!seasonal || !currentEnd || fromEndedSeason(pack, currentEnd, now)) return pack.endsAt;
  if (pack.startsAt && pack.startsAt >= currentEnd) {
    const guess = seasonEnd(currentEnd, new Date(pack.startsAt))!;
    return startSeason && (startSeason.complete || startSeason.end > guess) ? startSeason.end : guess;
  }
  return currentEnd;
}

/**
 * The season end the editor shows: the schedule's while it covers the season, otherwise what was typed (`edited`),
 * or the current end until the field is changed, so a season move synced in while the editor is open shows there.
 */
export const editorSeasonEnd = (scheduled: string | null, edited: string | null | undefined, currentEnd: string | null) =>
  scheduled ?? (edited === undefined ? currentEnd : edited);

/**
 * The date saving the editor moves the season to, or null. Only a date changed in the editor (`edited`, undefined
 * while untouched) moves it, so saving doesn't undo a move made meanwhile; never while the schedule sets the season,
 * for a pack from a season that has already ended, or to a date that isn't valid.
 */
export function seasonMoveOnSave(o: { seasonal: boolean; pastSeason: boolean; scheduled: string | null; edited: string | null | undefined; currentEnd: string | null }) {
  const { edited } = o;
  return o.seasonal && !o.pastSeason && !o.scheduled && edited && edited !== o.currentEnd && !isNaN(new Date(edited).getTime()) ? edited : null;
}

/**
 * Save an edited pack (already through editedPack and packEndOnSave), adding it if it's new. `moveSeasonTo` comes
 * from seasonMoveOnSave: every pack ending with the current season moves to it (see moveSeasonEnd). Mutates the state.
 * Returns false, saving nothing, for a store item that would sell nothing (its card deleted while the editor was open).
 */
export function savePack(d: AppState, pack: Pack, moveSeasonTo: string | null, now: Date) {
  const clean: Pack = kasketShape({ ...pack, name: pack.name.trim() });
  // Not drops for cards a sync deleted while the editor was open: they'd point at nothing. A store item left selling
  // nothing isn't saved at all, as it would never be cleared as done.
  clean.drops = clean.drops.filter((x) => d.cards.some((c) => c.id === x.cardId));
  if (clean.store && clean.drops.length === 0) return false;
  if (clean.currencyId === REALM_KLASH_CURRENCY) clean.season = isSeasonal(clean, d);
  else delete clean.season;
  const i = d.packs.findIndex((x) => x.id === clean.id);
  if (i >= 0) d.packs[i] = clean;
  else d.packs.push(clean);
  if (moveSeasonTo) moveSeasonEnd(d, moveSeasonTo, now);
  return true;
}

/**
 * Takes cards that are back in the list off the Maxed record: a Gold card pasted again for a new Stage, say, which
 * has copies to go once more. Matched by rarity and name, as the list matches cards. Mutates the state.
 */
export function unmarkMaxed(s: AppState, cards: Pick<Card, 'rarityId' | 'name'>[]) {
  if (!s.maxed?.length) return;
  const back = new Set(cards.map(recordKey));
  s.maxed = s.maxed.filter((m) => !back.has(recordKey(m)));
}

/** Adds cards to the Maxed record by hand (ones maxed before it existed), leaving out any already on it. Mutates the state. */
export function recordMaxed(s: AppState, cards: MaxedCard[]) {
  const recorded = new Set((s.maxed ?? []).map(recordKey));
  for (const c of cards) {
    if (recorded.has(recordKey(c))) continue;
    recorded.add(recordKey(c));
    (s.maxed ??= []).push({ name: c.name, rarityId: c.rarityId });
  }
}

/** Each card's share of an even pool: its total ÷ every item in the pool, which is at least the cards picked. */
export function poolShare(total: number | null, poolSize: number | null, picked: number) {
  return picked && total ? +(total / Math.max(poolSize ?? 0, picked)).toFixed(4) : 0;
}

/** Drops with an even pool added: a card already listed (e.g. its own 1.5% line) gets its share on top of its chance. */
export function addPool(drops: DropEntry[], picked: Iterable<string>, each: number): DropEntry[] {
  const ids = new Set(picked);
  return [
    ...drops.map((d) => (ids.has(d.cardId) ? { ...d, chance: +(d.chance + each).toFixed(4) } : d)),
    ...[...ids].filter((id) => !drops.some((d) => d.cardId === id)).map((cardId) => ({ cardId, chance: each })),
  ];
}

/** Sort key: soonest-ending first, permanent packs last. */
export const urgency = (p: Pack) => (p.endsAt ? new Date(p.endsAt).getTime() : Number.MAX_SAFE_INTEGER);

// ---------- Targets ----------

export interface Target {
  card: Card;
  phase: Phase;
  value: number;
  target: number;
  copiesToMax: number;
  copiesToThreshold: number;
  kardCopies: number;
  inPacks: number;
}

/** Cards ranked by how valuable their next copy is. Krypt/tower gear not sold in any pack is left out. */
export function rankTargets(ctx: Ctx, now: Date): Target[] {
  const activeDrops = ctx.state.packs.filter((p) => packStatus(p, now) !== 'expired').map((p) => new Set(packDrops(ctx, p).map((d) => d.cardId)));
  return ctx.state.cards
    .map((card) => {
      const rule = ctx.rules.get(card.rarityId)!;
      return {
        card,
        phase: copyPhase(ctx, card),
        value: copyValue(ctx, card),
        target: rule ? targetLevel(card, rule) : 0,
        copiesToMax: rule ? copiesToMax(card, rule) : 0,
        copiesToThreshold: rule ? copiesToThreshold(card, rule) : 0,
        kardCopies: ctx.kardCopies.get(card.id) ?? 0,
        inPacks: activeDrops.filter((ids) => ids.has(card.id)).length,
      };
    })
    .filter((t) => t.value > 0 && !(t.card.source && t.inPacks === 0))
    .sort((a, b) => b.value - a.value);
}
