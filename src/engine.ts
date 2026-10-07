import type { AppState, Card, DropEntry, Pack, RarityRule } from './types';

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
  /** Fusion Up Kards this assignment spends. */
  kards: number;
}

export interface KardPlan {
  assignments: KardAssignment[];
  /** Kards the plan couldn't use (not enough for any remaining step). */
  left: number;
  /** Cards that could take kards: at the threshold or higher, short of their goal, and not Realm Klash gear. */
  cards: number;
  /** Cheapest next step among those cards before any kards are spent, so "not enough kards" can name it. */
  cheapest: number | null;
  /** Realm Klash gear at the threshold or higher and short of its goal, left out of `cards`. */
  realmKlash: number;
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

/**
 * Realm Klash gear: equipment bought to max (its goal override) or sold as a Blood Ruby store item. It's maxed
 * with Blood Rubies, which come in daily, so Fusion Up Kards (much harder to get) are never spent on it.
 */
export function isRealmKlashGear(state: AppState, card: Card) {
  if (state.rarities.find((r) => r.id === card.rarityId)?.kind !== 'equipment') return false;
  return card.goal === 'max' || state.packs.some((p) => p.store && p.currencyId === REALM_KLASH_CURRENCY && p.drops.some((d) => d.cardId === card.id));
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
 * Kards work from the threshold (F3) up, through fusion and on into Gold ascension. Realm Klash gear gets none.
 */
function allocateKards(state: AppState) {
  const kardCopies = new Map<string, number>();
  const kardPlan = new Map<string, KardPlan>();
  for (const rule of state.rarities) {
    const thr = thresholdLevel(rule);
    if (thr == null || rule.fusionUpKards <= 0) continue;
    const cap = (c: Card) => targetLevel(c, rule);
    const open = state.cards.filter((c) => c.rarityId === rule.id && c.fusion >= thr && c.fusion < cap(c));
    const cards = open.filter((c) => !isRealmKlashGear(state, c));
    const costs = cards.map((c) => kardCost(rule, c.fusion)).filter((k): k is number => k != null);
    const level = new Map(cards.map((c) => [c.id, c.fusion]));
    const spent = new Map<string, number>();
    const stepsLeft = (c: Card) => cap(c) - level.get(c.id)!;
    const closer = (a: Card, b: Card) => stepsLeft(a) < stepsLeft(b) || (stepsLeft(a) === stepsLeft(b) && level.get(a.id)! > level.get(b.id)!);
    let left = rule.fusionUpKards;
    for (;;) {
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
    assignments.sort((a, b) => b.to - a.to || b.kards - a.kards);
    kardPlan.set(rule.id, { assignments, left, cards: cards.length, cheapest: costs.length ? Math.min(...costs) : null, realmKlash: open.length - cards.length });
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

/** Blood Ruby gear order, by name, for gear that isn't in the saved order yet. */
export const DEFAULT_GEAR_ORDER = ['Shadow Sash', "Moloch's Ball and Chain", 'Devastator', 'Datusha, Bane of the Moroi', 'Bloody Tomahawk'];

export interface GearStep {
  card: Card;
  /** Its Blood Ruby store items that haven't expired. */
  items: Pack[];
  /** Copies still to buy to its goal; no Fusion Up Kards go to this gear. */
  need: number;
}

/**
 * Realm Klash gear (equipment sold as a Blood Ruby store item) in buying order: the saved order first, then
 * DEFAULT_GEAR_ORDER, then by name.
 */
export function gearQueue(ctx: Ctx, now: Date): GearStep[] {
  const items = ctx.state.packs.filter((p) => p.store && p.currencyId === REALM_KLASH_CURRENCY && p.cost > 0 && packStatus(p, now) !== 'expired');
  const saved = ctx.state.gearOrder ?? [];
  const rank = (c: Card) => {
    const i = saved.indexOf(c.id);
    if (i >= 0) return i;
    const d = DEFAULT_GEAR_ORDER.indexOf(c.name);
    return d >= 0 ? saved.length + d : Infinity;
  };
  return ctx.state.cards
    .filter((c) => ctx.rules.get(c.rarityId)?.kind === 'equipment')
    .map((card) => {
      const rule = ctx.rules.get(card.rarityId)!;
      return {
        card,
        items: items.filter((p) => p.drops.some((d) => d.cardId === card.id)),
        need: copiesToMax(card, rule),
      };
    })
    .filter((g) => g.items.length > 0 && g.need > 0)
    .sort((a, b) => rank(a.card) - rank(b.card) || a.card.name.localeCompare(b.card.name));
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
      for (const d of p.drops) gained.set(d.cardId, (gained.get(d.cardId) ?? 0) + expectedCopies(p, d.chance));
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
export const ENDING_SOON_MS = 24 * 3600000;

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

/** Level a card up or down by one copy, within its rarity's range. */
export function stepCard(d: AppState, cardId: string, delta: 1 | -1) {
  const card = d.cards.find((c) => c.id === cardId);
  const rule = card && d.rarities.find((r) => r.id === card.rarityId);
  if (card && rule) card.fusion = Math.min(maxFusion(rule), Math.max(0, card.fusion + delta));
}

/**
 * Buy (delta 1) or take back (delta -1) one purchase of a pack: counts it, moves the cost out of (or back into)
 * the balance, and for a store item, which always gives its card, levels that card. Random packs leave the
 * cards to the "What did you pull?" step. Returns false when there's nothing to take back.
 *
 * A buy the balance doesn't cover takes it below 0 rather than stopping at 0: the typed balance was out of date,
 * and -1 (for a mis-tap) has to give back exactly what the buy took. The planner counts a negative balance as 0.
 */
export function recordPurchase(d: AppState, packId: string, delta: 1 | -1) {
  const pack = d.packs.find((x) => x.id === packId);
  if (!pack || (delta < 0 && pack.purchased <= 0)) return false;
  pack.purchased += delta;
  const cur = d.currencies.find((c) => c.id === pack.currencyId);
  if (cur) cur.balance -= delta * pack.cost;
  if (pack.store && pack.drops[0]) stepCard(d, pack.drops[0].cardId, delta);
  return true;
}

// ---------- Realm Klash seasons ----------

/** The Blood Ruby store's currency; its characters, Kameos and Kameo packs change every season. */
export const REALM_KLASH_CURRENCY = 'blood-rubies';
export const SEASON_DAYS = 14;

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
 * Change the current season's end (a corrected timer, or a season that ended early). Every seasonal pack that
 * was ending with it moves too; packs from earlier seasons keep their dates. Mutates the state.
 *
 * An item entered ahead for a later season (see packEndOnSave) ends 2 weeks at a time after the changeover it was
 * saved against, so it moves with that changeover to stay in the season it starts in. Left on its old date it would
 * expire while still in the store, and no later move would find it. One that starts right at the changeover opens
 * the next season, so it starts at the new one.
 *
 * `weekEnds` are the current season's earlier week ends, when the schedule knows them. The schedule can add a week
 * to a season after the saved end has passed, and that season's items still end on the saved date rather than the
 * 2-week guess, so a saved end on one of those week ends moves them too. Only an exact week end counts: a date typed
 * by hand, or set with Ended early, a little after the real changeover belongs to the season before.
 */
export function moveSeasonEnd(s: AppState, to: string, now: Date, weekEnds?: string[]) {
  const from = seasonEnd(s.realmKlashSeasonEnd, now);
  const saved = s.realmKlashSeasonEnd;
  const extended = saved && weekEnds?.includes(saved) ? saved : null;
  const changeovers = [from, extended].filter((c): c is string => !!c);
  for (const p of s.packs) {
    if (!p.season || !p.endsAt) continue;
    const start = p.startsAt;
    const ahead = start && changeovers.find((c) => start >= c && p.endsAt === seasonEnd(c, new Date(start)));
    if (ahead) {
      if (start === ahead) p.startsAt = to;
      p.endsAt = seasonEnd(to, new Date(p.startsAt!));
    } else if (changeovers.includes(p.endsAt)) p.endsAt = to;
  }
  s.realmKlashSeasonEnd = to;
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
 * ends with the season it starts in: `startSeasonEnd` when the schedule lists that season, otherwise 2 weeks at a
 * time. Other packs, and seasonal ones before any season end is known, keep their own end.
 */
export function packEndOnSave(pack: Pack, seasonal: boolean, currentEnd: string | null, now: Date, startSeasonEnd?: string | null) {
  if (!seasonal || !currentEnd || fromEndedSeason(pack, currentEnd, now)) return pack.endsAt;
  if (pack.startsAt && pack.startsAt >= currentEnd) return startSeasonEnd ?? seasonEnd(currentEnd, new Date(pack.startsAt));
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
 */
export function savePack(d: AppState, pack: Pack, moveSeasonTo: string | null, now: Date) {
  const clean: Pack = { ...pack, name: pack.name.trim() };
  if (clean.currencyId === REALM_KLASH_CURRENCY) clean.season = isSeasonal(clean, d);
  else delete clean.season;
  const i = d.packs.findIndex((x) => x.id === clean.id);
  if (i >= 0) d.packs[i] = clean;
  else d.packs.push(clean);
  if (moveSeasonTo) moveSeasonEnd(d, moveSeasonTo, now);
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
