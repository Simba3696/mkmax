import type { AppState, Card, Pack, RarityRule } from './types';

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

/** Stored level where Fusion Up Kards become usable, or null. */
export const thresholdLevel = (rule: RarityRule) => (rule.fusionUpThreshold == null ? null : fLevel(rule.fusionUpThreshold));

/** The card's goal: its own override (e.g. a Realm Klash epic bought to max), else the rarity's. */
export const cardGoal = (card: Card, rule: RarityRule) => card.goal ?? rule.goal;

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

export function copiesToThreshold(card: Card, rule: RarityRule) {
  const thr = thresholdLevel(rule);
  if (thr == null) return 0;
  return Math.max(0, copiesAtFusion(rule, thr) - copiesAtFusion(rule, card.fusion));
}

export const isMaxed = (card: Card, rule: RarityRule) => card.fusion >= targetLevel(card, rule);

/**
 * Cards that reached their goal are done, so they leave the app: the card, its pack drops, and any store
 * item that only sold done cards. Mutates the state and returns the removed cards' names.
 */
export function pruneDone(s: AppState): string[] {
  const rules = new Map(s.rarities.map((r) => [r.id, r]));
  const done = new Set(s.cards.filter((c) => rules.has(c.rarityId) && isMaxed(c, rules.get(c.rarityId)!)).map((c) => c.id));
  if (done.size === 0) return [];
  const names = s.cards.filter((c) => done.has(c.id)).map((c) => c.name);
  s.cards = s.cards.filter((c) => !done.has(c.id));
  s.packs = s.packs.filter((p) => !(p.store && p.drops.length > 0 && p.drops.every((d) => done.has(d.cardId))));
  for (const p of s.packs) p.drops = p.drops.filter((d) => !done.has(d.cardId));
  return names;
}

// ---------- Context ----------

export interface KardAssignment {
  cardId: string;
  from: number;
  to: number;
}

export interface Ctx {
  state: AppState;
  rules: Map<string, RarityRule>;
  cards: Map<string, Card>;
  /** Copies that allocated Fusion Up Kards will supply, per card. */
  kardCopies: Map<string, number>;
  kardPlan: Map<string, KardAssignment[]>;
}

/** Every card is worth maxing; guest cards count extra because they're only around during their event. */
export function cardWeight(state: AppState, card: Card) {
  return card.guest ? state.weights.guest : 1;
}

/**
 * Hand out Fusion Up Kards per rarity: eligible cards (at/above the threshold, below their fusion cap),
 * guest cards first, then the ones closest to max.
 * Kards only raise fusion levels, not ascension.
 */
function allocateKards(state: AppState) {
  const kardCopies = new Map<string, number>();
  const kardPlan = new Map<string, KardAssignment[]>();
  for (const rule of state.rarities) {
    const thr = thresholdLevel(rule);
    if (thr == null || rule.fusionUpKards <= 0) continue;
    const cap = (c: Card) => Math.min(targetLevel(c, rule), fLevel(rule.fusionMax));
    const eligible = state.cards
      .filter((c) => c.rarityId === rule.id && c.fusion >= thr && c.fusion < cap(c))
      .sort((a, b) => cardWeight(state, b) - cardWeight(state, a) || b.fusion - a.fusion);
    let left = rule.fusionUpKards;
    const plan: KardAssignment[] = [];
    for (const c of eligible) {
      if (left <= 0) break;
      const use = Math.min(left, cap(c) - c.fusion);
      plan.push({ cardId: c.id, from: c.fusion, to: c.fusion + use });
      kardCopies.set(c.id, copiesAtFusion(rule, c.fusion + use) - copiesAtFusion(rule, c.fusion));
      left -= use;
    }
    kardPlan.set(rule.id, plan);
  }
  return { kardCopies, kardPlan };
}

export function buildCtx(state: AppState): Ctx {
  const rules = new Map(state.rarities.map((r) => [r.id, r]));
  const cards = new Map(state.cards.map((c) => [c.id, c]));
  return { state, rules, cards, ...allocateKards(state) };
}

// ---------- Value of a copy ----------

export type Phase = 'unlock' | 'toThreshold' | 'normal' | 'kardCovered' | 'maxed' | 'skip';

/** Which phase the copy at position `g` (copies already gained beyond current) falls into. */
export function copyPhase(ctx: Ctx, card: Card, g = 0): Phase {
  const rule = ctx.rules.get(card.rarityId);
  if (!rule) return 'skip';
  const remaining = copiesToMax(card, rule);
  if (g >= remaining) return 'maxed';
  const pos = copiesAtFusion(rule, card.fusion) + g;
  if (pos < 1) return 'unlock';
  const thr = thresholdLevel(rule);
  if (thr != null && pos < copiesAtFusion(rule, thr)) return 'toThreshold';
  if (g >= remaining - (ctx.kardCopies.get(card.id) ?? 0)) return 'kardCovered';
  return 'normal';
}

export function copyValue(ctx: Ctx, card: Card, g = 0): number {
  const phase = copyPhase(ctx, card, g);
  if (phase === 'skip' || phase === 'maxed') return 0;
  const w = ctx.state.weights;
  const rule = ctx.rules.get(card.rarityId)!;
  const mult = { unlock: w.unlock, toThreshold: w.belowThreshold, kardCovered: w.coveredByKards, normal: 1 }[phase];
  const progress = (copiesAtFusion(rule, card.fusion) + g) / copiesAtFusion(rule, targetLevel(card, rule));
  return cardWeight(ctx.state, card) * mult * (1 + w.closenessBonus * progress);
}

/** Value of receiving `e` expected copies starting from `g` already gained (integrated across phase boundaries). */
export function gainValue(ctx: Ctx, card: Card, g: number, e: number): number {
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

export const purchasesLeft = (pack: Pack) =>
  pack.maxPurchases == null ? Infinity : Math.max(0, pack.maxPurchases - pack.purchased);

/** Expected copies of a drop per purchase. */
export const expectedCopies = (pack: Pack, chance: number) => pack.rolls * (chance / 100);

/** Chance of at least one copy of a drop per purchase. */
export const chanceAtLeastOne = (pack: Pack, chance: number) => 1 - Math.pow(1 - chance / 100, pack.rolls);

export function packEV(ctx: Ctx, pack: Pack, gained: Map<string, number> = new Map()): number {
  let v = 0;
  for (const d of pack.drops) {
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
  targets: { card: Card; value: number; pAtLeastOne: number; buysPerCopy: number }[];
}

export function rankPacks(ctx: Ctx, now: Date): PackRank[] {
  return ctx.state.packs
    .map((pack) => ({ pack, status: packStatus(pack, now) }))
    .filter((x): x is { pack: Pack; status: 'active' | 'upcoming' } => x.status !== 'expired')
    .map(({ pack, status }) => {
      const ev = packEV(ctx, pack);
      const targets = pack.drops
        .map((d) => {
          const card = ctx.cards.get(d.cardId);
          if (!card) return null;
          const e = expectedCopies(pack, d.chance);
          return { card, value: gainValue(ctx, card, 0, e), pAtLeastOne: chanceAtLeastOne(pack, d.chance), buysPerCopy: e > 0 ? 1 / e : Infinity };
        })
        .filter((t): t is NonNullable<typeof t> => t != null && t.value > 0)
        .sort((a, b) => b.value - a.value);
      return { pack, status, ev, evPerK: pack.cost > 0 ? (ev / pack.cost) * 1000 : 0, targets };
    })
    .sort((a, b) => b.evPerK - a.evPerK);
}

// ---------- Budget planner ----------

export interface PlannedBuy {
  pack: Pack;
  status: 'active' | 'upcoming';
  count: number;
  totalCost: number;
  ev: number;
}

export interface CurrencyPlan {
  currencyId: string;
  startBalance: number;
  spent: number;
  buys: PlannedBuy[];
  /** Best pack you couldn't afford another purchase of. */
  saveFor?: { pack: Pack; shortBy: number };
}

export interface Plan {
  currencies: CurrencyPlan[];
  /** Expected copies gained per card if you follow the plan. */
  expectedGains: Map<string, number>;
}

/**
 * Greedy: repeatedly buy the affordable pack with the best (marginal EV / cost), updating
 * expected card progress after each buy so later buys see diminishing returns.
 * Currencies are budgeted independently but share card progress.
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
    let budget = cur.balance;
    const score = (p: Pack) => (packEV(ctx, p, gained) / p.cost) * (p.endsAt ? boost : 1);

    for (let guard = 0; guard < 1000; guard++) {
      let best: Pack | null = null;
      let bestScore = 0;
      for (const { pack } of packs) {
        if (pack.cost > budget || (bought.get(pack.id) ?? 0) >= purchasesLeft(pack)) continue;
        const s = score(pack);
        if (s > bestScore + 1e-12) {
          best = pack;
          bestScore = s;
        }
      }
      if (!best) break;
      buyEv.set(best.id, (buyEv.get(best.id) ?? 0) + packEV(ctx, best, gained));
      for (const d of best.drops) gained.set(d.cardId, (gained.get(d.cardId) ?? 0) + expectedCopies(best, d.chance));
      bought.set(best.id, (bought.get(best.id) ?? 0) + 1);
      budget -= best.cost;
    }

    let saveFor: CurrencyPlan['saveFor'];
    let saveScore = 0;
    for (const { pack } of packs) {
      if (pack.cost <= budget || (bought.get(pack.id) ?? 0) >= purchasesLeft(pack)) continue;
      const s = score(pack);
      if (s > saveScore) {
        saveScore = s;
        saveFor = { pack, shortBy: pack.cost - budget };
      }
    }

    const buys = packs
      .filter(({ pack }) => bought.has(pack.id))
      .map(({ pack, status }) => ({ pack, status, count: bought.get(pack.id)!, totalCost: bought.get(pack.id)! * pack.cost, ev: buyEv.get(pack.id)! }))
      .sort((a, b) => urgency(a.pack) - urgency(b.pack));

    return { currencyId: cur.id, startBalance: cur.balance, spent: cur.balance - budget, buys, saveFor };
  });

  return { currencies, expectedGains: gained };
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
  const activePacks = ctx.state.packs.filter((p) => packStatus(p, now) !== 'expired');
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
        inPacks: activePacks.filter((p) => p.drops.some((d) => d.cardId === card.id)).length,
      };
    })
    .filter((t) => t.value > 0 && !(t.card.source && t.inPacks === 0))
    .sort((a, b) => b.value - a.value);
}
