import type { AppState, Card, Pack, RarityRule } from './types';

// ---------- Fusion math (in "copies": the unlock copy counts as 1) ----------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const maxFusion = (rule: RarityRule) => rule.dupesPerLevel.length + 1;
export const copiesTotal = (rule: RarityRule) => 1 + sum(rule.dupesPerLevel);

/** "F7" for fusion levels, "A3" for ascension levels. */
export const levelLabel = (rule: RarityRule | undefined, level: number) =>
  level <= 0 ? 'Not owned' : !rule || level <= rule.fusionMax ? `F${level}` : `A${level - rule.fusionMax}`;

/** Copies represented by being at level f (0 = not owned). */
export function copiesAtFusion(rule: RarityRule, f: number) {
  return f <= 0 ? 0 : 1 + sum(rule.dupesPerLevel.slice(0, f - 1));
}

/** The level this card is being worked toward: rarity max, per-card cap, or the kard threshold. */
export function targetLevel(card: Card, rule: RarityRule) {
  let t = maxFusion(rule);
  if (card.maxLevel != null) t = Math.min(t, card.maxLevel);
  if (rule.goal === 'threshold' && rule.fusionUpThreshold != null) t = Math.min(t, rule.fusionUpThreshold);
  return t;
}

/** Dupes needed to go from level f to f+1 (0 at max). */
const dupesForNext = (rule: RarityRule, f: number) => rule.dupesPerLevel[f - 1] ?? 0;

/** Copies a card represents: its level plus spare dupes collected toward the next level. */
export function copiesHave(card: Card, rule: RarityRule) {
  if (card.fusion <= 0) return 0;
  return copiesAtFusion(rule, card.fusion) + Math.min(card.spare ?? 0, Math.max(0, dupesForNext(rule, card.fusion) - 1));
}

export const copiesToMax = (card: Card, rule: RarityRule) =>
  Math.max(0, copiesAtFusion(rule, targetLevel(card, rule)) - copiesHave(card, rule));

export function copiesToThreshold(card: Card, rule: RarityRule) {
  if (rule.fusionUpThreshold == null) return 0;
  return Math.max(0, copiesAtFusion(rule, rule.fusionUpThreshold) - copiesHave(card, rule));
}

export const isMaxed = (card: Card, rule: RarityRule) => card.fusion >= targetLevel(card, rule);

/** Level + spare after receiving (delta = 1) or undoing (delta = -1) one copy. */
export function stepCopy(card: Card, rule: RarityRule, delta: 1 | -1): Pick<Card, 'fusion' | 'spare'> {
  const spare = card.spare ?? 0;
  if (delta > 0) {
    if (card.fusion <= 0) return { fusion: 1, spare: 0 };
    if (card.fusion >= maxFusion(rule)) return { fusion: card.fusion, spare: 0 };
    return spare + 1 >= dupesForNext(rule, card.fusion) ? { fusion: card.fusion + 1, spare: 0 } : { fusion: card.fusion, spare: spare + 1 };
  }
  if (spare > 0) return { fusion: card.fusion, spare: spare - 1 };
  if (card.fusion <= 1) return { fusion: 0, spare: 0 };
  return { fusion: card.fusion - 1, spare: Math.max(0, dupesForNext(rule, card.fusion - 1) - 1) };
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

export function cardPriority(state: AppState, card: Card) {
  return state.weights.tier[card.tier] * (card.guest ? state.weights.guest : 1);
}

/**
 * Hand out Fusion Up Kards per rarity: highest-priority eligible cards (at/above the
 * threshold, below their fusion cap) first, ties broken by highest fusion.
 * Kards only raise fusion levels, not ascension.
 */
function allocateKards(state: AppState) {
  const kardCopies = new Map<string, number>();
  const kardPlan = new Map<string, KardAssignment[]>();
  for (const rule of state.rarities) {
    if (rule.fusionUpThreshold == null || rule.fusionUpKards <= 0 || rule.goal === 'threshold') continue;
    const cap = (c: Card) => Math.min(targetLevel(c, rule), rule.fusionMax);
    const eligible = state.cards
      .filter((c) => c.rarityId === rule.id && c.tier !== 'skip' && c.fusion >= rule.fusionUpThreshold! && c.fusion < cap(c))
      .sort((a, b) => cardPriority(state, b) - cardPriority(state, a) || b.fusion - a.fusion);
    let left = rule.fusionUpKards;
    const plan: KardAssignment[] = [];
    for (const c of eligible) {
      if (left <= 0) break;
      const use = Math.min(left, cap(c) - c.fusion);
      plan.push({ cardId: c.id, from: c.fusion, to: c.fusion + use });
      kardCopies.set(c.id, copiesAtFusion(rule, c.fusion + use) - copiesHave(c, rule));
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
  if (ctx.state.weights.tier[card.tier] <= 0) return 'skip';
  const remaining = copiesToMax(card, rule);
  if (g >= remaining) return 'maxed';
  const pos = copiesHave(card, rule) + g;
  if (pos < 1) return 'unlock';
  if (rule.fusionUpThreshold != null && pos < copiesAtFusion(rule, rule.fusionUpThreshold)) return 'toThreshold';
  if (g >= remaining - (ctx.kardCopies.get(card.id) ?? 0)) return 'kardCovered';
  return 'normal';
}

export function copyValue(ctx: Ctx, card: Card, g = 0): number {
  const phase = copyPhase(ctx, card, g);
  if (phase === 'skip' || phase === 'maxed') return 0;
  const w = ctx.state.weights;
  const rule = ctx.rules.get(card.rarityId)!;
  const mult = { unlock: w.unlock, toThreshold: w.belowThreshold, kardCovered: w.coveredByKards, normal: 1 }[phase];
  const progress = (copiesHave(card, rule) + g) / copiesAtFusion(rule, targetLevel(card, rule));
  return cardPriority(ctx.state, card) * mult * (1 + w.closenessBonus * progress);
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
