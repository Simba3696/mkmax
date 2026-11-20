// Klash Tower builder: fills the 5 defensive floors of a Realm Klash tower from the season's pool. Pure like engine.ts
// (no React, no fetch, no clock): it reads catalog items with the tower fields scripts/fetch-catalog.mjs adds, and
// the user's pool and pins, and the screen shows what it returns. See docs/how-it-works.md → Klash Tower.
import { nameKey } from './names';

export type Slot = 'weapon' | 'armor' | 'accessory';
export const SLOTS: Slot[] = ['weapon', 'armor', 'accessory'];

/** The fields the builder reads from a catalog item; only kind, name and rarity are always there. */
export interface KlashItem {
  kind: 'character' | 'equipment' | 'kameo';
  name: string;
  rarity: string | null;
  tags?: string[];
  class?: string[];
  team?: string;
  attack?: number;
  health?: number;
  /** MK Mobile Base community score and how many voted. */
  score?: number;
  votes?: number;
  /** Partners named by the character's MK Mobile Base guide, and the wiki's Team Passive text and Good With list. */
  bestTeams?: string[];
  passive?: string;
  goodWith?: string[];
  slot?: Slot;
  /** A gear set piece: whose Friendship or Brutality set it belongs to. */
  set?: 'friendship' | 'brutality';
  setFor?: string[];
}

/** One floor's limits as the game sets them: which rarities may go there, and at which fusion level (9 or 10). */
export interface FloorRule {
  floor: 1 | 2 | 3 | 4 | 5;
  characters: Partial<Record<'gold' | 'diamond', 9 | 10>>;
  gear: Partial<Record<'rare' | 'epic', 9 | 10>>;
  kameo: 'gold' | 'diamond';
}

/** The game's floor limits (confirmed by the user, 2026-11-14). The builder and the Tower screen both read this. */
export const FLOORS: FloorRule[] = [
  { floor: 1, characters: { gold: 10 }, gear: { rare: 9 }, kameo: 'gold' },
  { floor: 2, characters: { gold: 10, diamond: 9 }, gear: { rare: 10 }, kameo: 'gold' },
  { floor: 3, characters: { gold: 10, diamond: 9 }, gear: { rare: 10, epic: 9 }, kameo: 'gold' },
  { floor: 4, characters: { gold: 10, diamond: 10 }, gear: { rare: 10, epic: 10 }, kameo: 'diamond' },
  { floor: 5, characters: { diamond: 10 }, gear: { rare: 10, epic: 10 }, kameo: 'diamond' },
];

// The scoring formula (agreed in the eng review, 2026-11-15). The numbers are starting guesses meant to be tuned after
// playing a season; docs/how-it-works.md explains each one.
/** Fighter strength from attack + health is scaled to 0..this across every Gold and Diamond character. */
export const STRENGTH_SCALE = 10;
/** A fighter one fusion level below F10 counts at this share of its strength. */
export const BELOW_F10 = 0.95;
/** The community score only nudges a card once this many people have voted; then it adds (score − 3) × weight. */
export const MIN_VOTES = 3;
export const SCORE_MIDPOINT = 3;
export const SCORE_WEIGHT = 0.5;
/** Team synergy: a teammate the Team Passive covers, a known pairing (Good With or best teams), a shared team or class. */
export const PASSIVE_POINTS = 3;
export const PAIRING_POINTS = 2;
export const TEAM_POINTS = 1;
export const CLASS_POINTS = 0.5;
/** Kameo: per fighter sharing its class, and per effect it shares with the team. */
export const KAMEO_CLASS_POINTS = 1;
export const KAMEO_EFFECT_POINTS = 1;
/** Gear: a piece of the wearer's own set, and each effect it shares with the wearer. */
export const OWN_SET_POINTS = 3;
export const GEAR_EFFECT_POINTS = 1;
/** The most open characters a floor's trio search tries, strongest first: 30 make about 4,000 trios. */
export const MAX_TRIO_CANDIDATES = 30;
/** Gear rarity, so Epic goes where it's allowed and Rare is kept for the floors that can only take Rare. */
export const GEAR_RARITY_POINTS: Record<string, number> = { epic: 2, rare: 1 };

/** A card's identity in the pool and pins: its kind and order-free name, so a catalog spelling change keeps it. */
export const klashKey = (item: Pick<KlashItem, 'kind' | 'name'>) => `${item.kind}:${nameKey(item.name)}`;

export interface Reason {
  points: number;
  text: string;
}
export interface GearPick {
  item: KlashItem;
  slot: Slot;
  /** True for a Diamond's extra piece. */
  extra: boolean;
  points: number;
}
export interface Fighter {
  item: KlashItem;
  level: 9 | 10;
  strength: number;
  pinned: boolean;
  /** True when the catalog has no stats for it, so it scores from its rarity alone. */
  noData: boolean;
  gear: GearPick[];
}
export interface FloorPlan {
  rule: FloorRule;
  fighters: Fighter[];
  kameo: { item: KlashItem; pinned: boolean; points: number } | null;
  /** What the floor is missing, e.g. "needs 1 more Gold character". */
  short: string[];
  /** The biggest synergy terms behind the pick, largest first. */
  reasons: Reason[];
  score: number;
}
export interface Tower {
  /** Floors 1 to 5 in order. */
  floors: FloorPlan[];
  /** Pool keys the catalog doesn't have (renamed or dropped since they were ticked). */
  missing: string[];
  /** Pool gear the catalog gives no slot for, which can't be placed. */
  noSlot: KlashItem[];
  /** Pool cards left over after every floor is full. */
  bench: KlashItem[];
}

const hasStats = (c: KlashItem) => typeof c.attack === 'number' && typeof c.health === 'number';
const nudge = (c: KlashItem) => (typeof c.score === 'number' && (c.votes ?? 0) >= MIN_VOTES ? (c.score - SCORE_MIDPOINT) * SCORE_WEIGHT : 0);
const byName = (a: KlashItem, b: KlashItem) => a.name.localeCompare(b.name);
const lower = (s: string) => s.toLowerCase();

/**
 * Everything the builder works out once per catalog: the stat range strength is scaled across, a no-data fighter's
 * strength per rarity, and which tags name a fighter, team, class, slot or set (so only effect tags count as shared).
 */
export function klashContext(items: KlashItem[]) {
  const fighters = items.filter((c) => c.kind === 'character' && (c.rarity === 'gold' || c.rarity === 'diamond'));
  const totals = fighters.filter(hasStats).map((c) => c.attack! + c.health!);
  const min = totals.length ? Math.min(...totals) : 0;
  const max = totals.length ? Math.max(...totals) : 1;
  const scaled = (c: KlashItem) => (max > min ? ((c.attack! + c.health! - min) / (max - min)) * STRENGTH_SCALE : STRENGTH_SCALE / 2);
  // A fighter with no stats counts as the middle fighter of its rarity: its rarity is all the builder knows.
  const median = (rarity: string) => {
    const v = fighters.filter((c) => c.rarity === rarity && hasStats(c)).map(scaled).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : STRENGTH_SCALE / 2;
  };
  const noData: Record<string, number> = { gold: median('gold'), diamond: median('diamond') };
  const identity = new Set<string>(['friendship', 'brutality', ...SLOTS]);
  // The builder asks for the same card's effects thousands of times while it tries trios and gear.
  const effectCache = new WeakMap<KlashItem, Set<string>>();
  for (const c of items) {
    if (c.team) identity.add(lower(c.team));
    for (const k of c.class ?? []) identity.add(lower(k));
    // A character's tags start with its fighter's name ("cassie cage" on Cassie Cage Kombat Cup).
    if (c.kind === 'character') for (const t of c.tags ?? []) if (lower(c.name).startsWith(t)) identity.add(t);
  }
  return {
    strength: (c: KlashItem) => (hasStats(c) ? scaled(c) : (noData[c.rarity ?? ''] ?? STRENGTH_SCALE / 2)),
    effects: (c: KlashItem) => {
      let e = effectCache.get(c);
      if (!e) effectCache.set(c, (e = new Set((c.tags ?? []).filter((t) => !identity.has(t)))));
      return e;
    },
  };
}
type Ctx = ReturnType<typeof klashContext>;

/** Whether A's Team Passive covers B: it names B's team or a class of B's; with no passive text, A's own team. */
function passiveCovers(a: KlashItem, b: KlashItem) {
  if (a.passive) {
    const p = lower(a.passive);
    return (!!b.team && p.includes(lower(b.team))) || (b.class ?? []).some((k) => p.includes(lower(k)));
  }
  return !!a.team && a.team === b.team;
}

// Name keys of a card's list (Good With, best teams, set owners), kept per list so trying trios doesn't redo them.
const nameCache = new WeakMap<string[], Set<string>>();
const noNames = new Set<string>();
function names(list: string[] | undefined) {
  if (!list) return noNames;
  let s = nameCache.get(list);
  if (!s) nameCache.set(list, (s = new Set(list.map(nameKey))));
  return s;
}

/** The synergy terms of a trio (no-data fighters take part in none), largest first, ties by text. */
function synergy(trio: KlashItem[]): Reason[] {
  const out: Reason[] = [];
  const known = trio.filter(hasStats);
  for (const a of known)
    for (const b of known) if (a !== b && passiveCovers(a, b)) out.push({ points: PASSIVE_POINTS, text: `${a.name}'s Team Passive covers ${b.name}` });
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const [a, b] = [known[i], known[j]];
      const pair = [a, b].sort(byName);
      const links = (x: KlashItem, y: KlashItem) => names(x.goodWith).has(nameKey(y.name)) || names(x.bestTeams).has(nameKey(y.name));
      if (links(a, b) || links(b, a))
        out.push({ points: PAIRING_POINTS, text: `${pair[0].name} and ${pair[1].name} are a known good pairing` });
      if (a.team && a.team === b.team) out.push({ points: TEAM_POINTS, text: `${pair[0].name} and ${pair[1].name} are both ${a.team}` });
      const shared = (a.class ?? []).filter((k) => (b.class ?? []).includes(k));
      if (shared.length) out.push({ points: CLASS_POINTS, text: `${pair[0].name} and ${pair[1].name} are both ${shared[0]}` });
    }
  return out.sort((x, y) => y.points - x.points || x.text.localeCompare(y.text));
}

const fighterStrength = (ctx: Ctx, c: KlashItem, level: 9 | 10) => (ctx.strength(c) + nudge(c)) * (level === 9 ? BELOW_F10 : 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// A pair's synergy points, kept per pair: the trio search scores thousands of trios from the same few pairs.
const pairCache = new WeakMap<KlashItem, Map<KlashItem, number>>();
function pairPoints(a: KlashItem, b: KlashItem) {
  let row = pairCache.get(a);
  if (!row) pairCache.set(a, (row = new Map()));
  let p = row.get(b);
  if (p === undefined) row.set(b, (p = sum(synergy([a, b]).map((r) => r.points))));
  return p;
}

function trioScore(ctx: Ctx, rule: FloorRule, trio: KlashItem[]) {
  let s = sum(trio.map((c) => fighterStrength(ctx, c, rule.characters[c.rarity as 'gold' | 'diamond']!)));
  for (let i = 0; i < trio.length; i++) for (let j = i + 1; j < trio.length; j++) s += pairPoints(trio[i], trio[j]);
  return s;
}

/** Every k-card combination of the list, in list order (the list is sorted by name, so ties resolve by name). */
function combinations<T>(list: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i <= list.length - k; i++) for (const rest of combinations(list.slice(i + 1), k - 1)) out.push([list[i], ...rest]);
  return out;
}

const rarityWords = (r: Partial<Record<string, unknown>>) =>
  Object.keys(r)
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join(' or ');

function kameoPoints(ctx: Ctx, kameo: KlashItem, trio: KlashItem[]) {
  const teamEffects = new Set(trio.flatMap((c) => [...ctx.effects(c)]));
  const classes = trio.filter((c) => (c.class ?? []).some((k) => (kameo.class ?? []).includes(k))).length;
  const effects = [...ctx.effects(kameo)].filter((t) => teamEffects.has(t)).length;
  return classes * KAMEO_CLASS_POINTS + effects * KAMEO_EFFECT_POINTS;
}

function gearPoints(ctx: Ctx, piece: KlashItem, wearer: KlashItem) {
  const own = names(piece.setFor).has(nameKey(wearer.name)) ? OWN_SET_POINTS : 0;
  const wearerEffects = ctx.effects(wearer);
  const shared = [...ctx.effects(piece)].filter((t) => wearerEffects.has(t)).length;
  return (GEAR_RARITY_POINTS[piece.rarity ?? ''] ?? 0) + own + shared * GEAR_EFFECT_POINTS + nudge(piece);
}

/** Whether the wearer may also wear this piece: not pieces of both its own Friendship and Brutality sets. */
function setClash(piece: KlashItem, wearer: KlashItem, worn: GearPick[]) {
  if (!piece.set || !names(piece.setFor).has(nameKey(wearer.name))) return false;
  return worn.some((g) => g.item.set && g.item.set !== piece.set && names(g.item.setFor).has(nameKey(wearer.name)));
}

/**
 * Builds the tower: floor 5 first with the strongest Diamond trio, then 4, 3, 2 and 1, each picking the trio with the
 * most strength plus synergy from what's left (pinned cards stay on their floors), then a Kameo per floor, then gear.
 * A floor that may take Gold leaves enough Gold characters for floor 1, and Rare gear for floors 1 and 2, which can
 * take nothing else. Ties break by name, so the same pool builds the same tower everywhere.
 */
export function buildTower(items: KlashItem[], pool: string[], pins: Record<string, number> = {}): Tower {
  const ctx = klashContext(items);
  const byKey = new Map<string, KlashItem>();
  for (const c of items) if (!byKey.has(klashKey(c))) byKey.set(klashKey(c), c);
  const keys = [...new Set(pool)];
  const missing = keys.filter((k) => !byKey.has(k)).sort();
  const chosen = keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])).sort(byName);
  const chars = chosen.filter((c) => c.kind === 'character' && (c.rarity === 'gold' || c.rarity === 'diamond'));
  const kameos = chosen.filter((c) => c.kind === 'kameo' && (c.rarity === 'gold' || c.rarity === 'diamond'));
  const gear = chosen.filter((c) => c.kind === 'equipment' && (c.rarity === 'rare' || c.rarity === 'epic'));
  const noSlot = gear.filter((c) => !c.slot);
  const placeable = gear.filter((c) => c.slot);

  // Pins the floor's limits allow, at most 3 characters and 1 Kameo per floor (by name), each card on one floor.
  const pinOf = new Map<KlashItem, number>();
  for (const rule of FLOORS) {
    const here = (c: KlashItem) => pins[klashKey(c)] === rule.floor;
    chars.filter((c) => here(c) && rule.characters[c.rarity as 'gold' | 'diamond']).slice(0, 3).forEach((c) => pinOf.set(c, rule.floor));
    // A Kameo pinned beside a pinned fighter of its exact version can't stay: the game won't allow the pair.
    const pinnedHere = chars.filter((c) => pinOf.get(c) === rule.floor).map((c) => nameKey(c.name));
    kameos
      .filter((c) => here(c) && c.rarity === rule.kameo && !pinnedHere.includes(nameKey(c.name)))
      .slice(0, 1)
      .forEach((c) => pinOf.set(c, rule.floor));
  }
  const used = new Set<KlashItem>(pinOf.keys());
  const plans = new Map<number, FloorPlan>();
  const openBelow = (floor: number, rarity: 'gold') =>
    sum(FLOORS.filter((r) => r.floor < floor && Object.keys(r.characters).join() === rarity).map((r) => 3 - chars.filter((c) => pinOf.get(c) === r.floor).length));

  for (const rule of [...FLOORS].reverse()) {
    const pinned = chars.filter((c) => pinOf.get(c) === rule.floor);
    const pinnedKameo = kameos.find((c) => pinOf.get(c) === rule.floor) ?? null;
    // Only the strongest few are tried: every trio of a pool ticked from most of the catalog would freeze a phone. A real
    // season deals about 26 characters, so it's always tried in full.
    const candidates = chars
      .filter((c) => !used.has(c) && rule.characters[c.rarity as 'gold' | 'diamond'] && !(pinnedKameo && nameKey(pinnedKameo.name) === nameKey(c.name)))
      .map((c) => [c, fighterStrength(ctx, c, rule.characters[c.rarity as 'gold' | 'diamond']!)] as const)
      .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
      .slice(0, MAX_TRIO_CANDIDATES)
      .map(([c]) => c)
      .sort(byName);
    const goldLeft = chars.filter((c) => !used.has(c) && c.rarity === 'gold').length;
    const goldSpare = rule.characters.diamond ? Math.max(0, goldLeft - openBelow(rule.floor, 'gold')) : Infinity;
    const need = Math.min(3 - pinned.length, candidates.length);
    let best: KlashItem[] = [];
    let bestScore = -Infinity;
    for (const combo of combinations(candidates, need)) {
      if (combo.filter((c) => c.rarity === 'gold').length > goldSpare) continue;
      const s = trioScore(ctx, rule, [...pinned, ...combo]);
      if (s > bestScore) [best, bestScore] = [combo, s];
    }
    // With too few spare Gold for any full trio, the floor takes the best it can and says what it's short of.
    // It searches every smaller group within the Gold limit, so the spare Gold it takes are the strongest, not the first.
    if (bestScore === -Infinity && need > 0) {
      const golds = candidates.filter((c) => c.rarity === 'gold').length;
      const size = Math.min(need, candidates.length - golds + Math.min(golds, goldSpare));
      for (const combo of combinations(candidates, size)) {
        if (combo.filter((c) => c.rarity === 'gold').length > goldSpare) continue;
        const s = trioScore(ctx, rule, [...pinned, ...combo]);
        if (s > bestScore) [best, bestScore] = [combo, s];
      }
    }
    best.forEach((c) => used.add(c));
    const trio = [...pinned, ...best].sort(byName);
    const fighters: Fighter[] = trio.map((c) => {
      const level = rule.characters[c.rarity as 'gold' | 'diamond']!;
      return { item: c, level, strength: fighterStrength(ctx, c, level), pinned: pinOf.get(c) === rule.floor, noData: !hasStats(c), gear: [] };
    });
    // The Kameo: pinned, or the one that suits the trio best, never the exact version of a fighter on the floor.
    let kameo: FloorPlan['kameo'] = pinnedKameo ? { item: pinnedKameo, pinned: true, points: kameoPoints(ctx, pinnedKameo, trio) } : null;
    if (!kameo) {
      const open = kameos.filter((k) => !used.has(k) && k.rarity === rule.kameo && !trio.some((c) => nameKey(c.name) === nameKey(k.name)));
      let top: KlashItem | null = null;
      let topPoints = -Infinity;
      for (const k of open) {
        const p = kameoPoints(ctx, k, trio);
        if (p > topPoints) [top, topPoints] = [k, p];
      }
      if (top) kameo = { item: top, pinned: false, points: topPoints };
    }
    if (kameo) used.add(kameo.item);
    const short: string[] = [];
    if (trio.length < 3) short.push(`needs ${3 - trio.length} more ${rarityWords(rule.characters)} character${3 - trio.length === 1 ? '' : 's'}`);
    if (!kameo) short.push(`needs a ${rarityWords({ [rule.kameo]: 1 })} Kameo`);
    const reasons = synergy(trio);
    plans.set(rule.floor, { rule, fighters, kameo, short, reasons: reasons.slice(0, 3), score: trioScore(ctx, rule, trio) + (kameo?.points ?? 0) });
  }

  // Gear: every fighter's three slots, floor 5 first, then each Diamond's extra piece from what's left.
  const free = new Set(placeable);
  const fightersOn = (floor: number) => plans.get(floor)!.fighters;
  const rareKeptFor = (floor: number, slot: Slot) =>
    sum(FLOORS.filter((r) => r.floor < floor && !r.gear.epic).map((r) => fightersOn(r.floor).filter((f) => !f.gear.some((g) => g.slot === slot)).length));
  const pass = (extra: boolean) => {
    for (const rule of [...FLOORS].reverse()) {
      const plan = plans.get(rule.floor)!;
      const wearers = extra ? plan.fighters.filter((f) => f.item.rarity === 'diamond') : plan.fighters;
      const wants = (f: Fighter, slot: Slot) => (extra ? f.gear.length === 3 : !f.gear.some((g) => g.slot === slot));
      for (;;) {
        let pick: { f: Fighter; slot: Slot; item: KlashItem; points: number } | null = null;
        // Rare of each slot still free, against what the Rare-only floors below still need.
        const rareSpare = new Map(SLOTS.map((s) => [s, [...free].filter((g) => g.rarity === 'rare' && g.slot === s).length - rareKeptFor(rule.floor, s)]));
        for (const f of wearers)
          for (const slot of SLOTS) {
            if (!wants(f, slot)) continue;
            for (const item of free) {
              if (item.slot !== slot || !rule.gear[item.rarity as 'rare' | 'epic'] || setClash(item, f.item, f.gear)) continue;
              // A floor that can take Epic leaves enough Rare of each slot for the floors that can't.
              if (rule.gear.epic && item.rarity === 'rare' && rareSpare.get(slot)! <= 0) continue;
              const points = gearPoints(ctx, item, f.item);
              const better =
                !pick ||
                points > pick.points ||
                (points === pick.points && (f.item.name.localeCompare(pick.f.item.name) || SLOTS.indexOf(slot) - SLOTS.indexOf(pick.slot) || item.name.localeCompare(pick.item.name)) < 0);
              if (better) pick = { f, slot, item, points };
            }
          }
        if (!pick) break;
        pick.f.gear.push({ item: pick.item, slot: pick.slot, extra, points: pick.points });
        free.delete(pick.item);
        plan.score += pick.points;
      }
    }
  };
  pass(false);
  pass(true);
  for (const plan of plans.values()) for (const f of plan.fighters) f.gear.sort((a, b) => Number(a.extra) - Number(b.extra) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));

  const placed = new Set([...used, ...[...plans.values()].flatMap((p) => p.fighters.flatMap((f) => f.gear.map((g) => g.item)))]);
  return {
    floors: FLOORS.map((r) => plans.get(r.floor)!),
    missing,
    noSlot,
    bench: chosen.filter((c) => !placed.has(c) && !noSlot.includes(c) && (chars.includes(c) || kameos.includes(c) || gear.includes(c))),
  };
}

/** The floors a card may be pinned to: those whose limits allow its rarity. */
export const pinFloors = (item: KlashItem) =>
  FLOORS.filter((r) => (item.kind === 'character' ? !!r.characters[item.rarity as 'gold' | 'diamond'] : item.kind === 'kameo' && r.kameo === item.rarity)).map((r) => r.floor);
