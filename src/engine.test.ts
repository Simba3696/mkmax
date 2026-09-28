import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import {
  buildCtx, buildPlan, copiesAtFusion, kardCost, copiesToMax, copiesToThreshold, copyPhase, fLevel as F, isMaxed, levelLabel, moveSeasonEnd, packEV, packStatus, pruneDone, seasonEnd, suggestSeason, targetLevel,
} from './engine';
import { normalize } from './store';
import type { AppState, Card, Pack } from './types';

const NOW = new Date('2026-01-10T12:00:00');
/** Stored level for ascension An on a rarity whose fusion tops out at F10. */
const A = (n: number) => F(10) + n;

function setup(cards: Card[], packs: Pack[] = [], tweak?: (s: AppState) => void) {
  const s = defaultState();
  s.cards = cards;
  s.packs = packs;
  tweak?.(s);
  return s;
}

const card = (id: string, fusion: number, extra: Partial<Card> = {}): Card => ({ id, name: id, rarityId: 'diamond', fusion, guest: false, ...extra });
const pack = (id: string, drops: Pack['drops'], extra: Partial<Pack> = {}): Pack => ({
  id, name: id, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops, ...extra,
});
const rules = () => new Map(defaultState().rarities.map((r) => [r.id, r]));

describe('fusion math', () => {
  it('starts at F0 with 1 dupe per level', () => {
    const rule = rules().get('diamond')!;
    expect(levelLabel(rule, 0)).toBe('Not owned');
    expect(levelLabel(rule, 1)).toBe('F0');
    expect(copiesAtFusion(rule, F(0))).toBe(1);
    expect(copiesAtFusion(rule, F(10))).toBe(11);
    expect(copiesToMax(card('a', 0), rule)).toBe(11);
    expect(copiesToThreshold(card('a', F(1)), rule)).toBe(2);
    expect(copiesToThreshold(card('a', F(4)), rule)).toBe(0);
  });
});

describe('goals and caps', () => {
  it('caps gold at the per-card ascension level', () => {
    const gold = rules().get('gold')!;
    const a5 = card('g', A(1), { rarityId: 'gold', maxLevel: A(5) });
    expect(levelLabel(gold, A(1))).toBe('A1');
    expect(levelLabel(gold, F(10))).toBe('F10');
    expect(targetLevel(a5, gold)).toBe(A(5));
    expect(copiesToMax(a5, gold)).toBe(4);
    expect(copiesToMax(card('g', A(6), { rarityId: 'gold' }), gold)).toBe(4); // A6 → A10
  });

  it('tracks threshold-goal equipment only until F3 (4 copies from nothing)', () => {
    const epic = rules().get('epic')!;
    expect(copiesToMax(card('e', 0, { rarityId: 'epic' }), epic)).toBe(4);
    expect(copiesToMax(card('e', F(2), { rarityId: 'epic' }), epic)).toBe(1);
    expect(isMaxed(card('e', F(3), { rarityId: 'epic' }), epic)).toBe(true);
  });

  it('lets a card override its rarity goal (Realm Klash epics go to max)', () => {
    const epic = rules().get('epic')!;
    const rk = card('rk', F(7), { rarityId: 'epic', goal: 'max' });
    expect(targetLevel(rk, epic)).toBe(F(10));
    expect(copiesToMax(rk, epic)).toBe(3);
    expect(isMaxed(rk, epic)).toBe(false);
  });
});

describe('kameos', () => {
  const kameo = (name: string, fusion = 0) => card(name, fusion, { rarityId: 'kameo-gold' });

  it('only need one copy, and leave the app once owned', () => {
    const rule = rules().get('kameo-gold')!;
    expect(levelLabel(rule, 1)).toBe('F0');
    expect(copiesToMax(kameo('k'), rule)).toBe(1);
    const s = setup([kameo('have', 1), kameo('want')]);
    expect(pruneDone(s)).toEqual(['have']);
    expect(s.cards.map((c) => c.id)).toEqual(['want']);
  });

  it('get Blood Rubies only after the Realm Klash gear', () => {
    const s = setup(
      [card('gear', F(8), { rarityId: 'epic', goal: 'max' }), kameo('k')],
      [
        pack('gear-item', [{ cardId: 'gear', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
        pack('kameo-item', [{ cardId: 'k', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
      ],
      (s) => (s.currencies.find((c) => c.id === 'blood-rubies')!.balance = 1600),
    );
    const rubies = buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    expect(rubies.buys.map((b) => [b.pack.id, b.count])).toEqual([['gear-item', 2]]);
    // With more rubies than the gear needs, the rest goes to the Kameo.
    s.currencies.find((c) => c.id === 'blood-rubies')!.balance = 3200;
    const more = buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    expect(Object.fromEntries(more.buys.map((b) => [b.pack.id, b.count]))).toEqual({ 'gear-item': 2, 'kameo-item': 1 });
  });
});

describe('save migration', () => {
  it('shifts version-1 levels (first copy = F1) to F0-based storage', () => {
    const v1 = { version: 1, rarities: [], currencies: [], packs: [], cards: [card('a', 2, { maxLevel: 15 }), card('b', 0)] };
    const s = normalize(v1);
    expect(s.version).toBe(defaultState().version);
    expect(s.cards.map((c) => [c.fusion, c.maxLevel])).toEqual([[3, 16], [0, undefined]]);
  });

  it('adds the Kameo rarity to older saves once', () => {
    const noKameos = defaultState().rarities.filter((r) => r.kind !== 'kameo');
    const v2 = { ...defaultState(), version: 2, rarities: noKameos };
    expect(normalize(v2).rarities.map((r) => r.id)).toEqual(expect.arrayContaining(['kameo-diamond', 'kameo-gold']));
    // A version-3 save without a Kameo rarity means the user deleted it; don't bring it back.
    expect(normalize({ ...v2, version: 3 }).rarities.some((r) => r.kind === 'kameo')).toBe(false);
  });

  it('splits the single version-3 Kameo rarity into Diamond and Gold, keeping its cards as Diamond', () => {
    const single = { id: 'kameo', label: 'Kameo', kind: 'kameo' as const, color: '#ff7ab8', dupesPerLevel: [], fusionMax: 0, goal: 'max' as const, hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [] };
    const v3 = { ...defaultState(), version: 3, rarities: [...defaultState().rarities.filter((r) => r.kind !== 'kameo'), single], cards: [card('baraka', 0, { rarityId: 'kameo' })] };
    const s = normalize(v3);
    expect(s.rarities.map((r) => r.id)).not.toContain('kameo');
    expect(s.rarities.map((r) => r.id)).toEqual(expect.arrayContaining(['kameo-diamond', 'kameo-gold']));
    expect(s.cards.map((c) => c.rarityId)).toEqual(['kameo-diamond']);
  });

  it('moves Blood Ruby gear to Epic with a max goal, and drops priority tiers', () => {
    const old = {
      ...defaultState(),
      rarities: [...defaultState().rarities, { ...defaultState().rarities[2], id: 'blood-ruby', label: 'Blood Ruby Equip', goal: 'max' }],
      weights: { ...defaultState().weights, tier: { must: 3, want: 2, nice: 1, skip: 0 } },
      cards: [{ ...card('sash', F(7), { rarityId: 'blood-ruby' }), tier: 'want' }],
    };
    const s = normalize(old);
    expect(s.rarities.map((r) => r.id)).not.toContain('blood-ruby');
    expect(s.cards).toEqual([expect.objectContaining({ id: 'sash', rarityId: 'epic', goal: 'max', fusion: F(7) })]);
    expect(s.cards[0]).not.toHaveProperty('tier');
    expect(s.weights).not.toHaveProperty('tier');
  });
});

describe('phases', () => {
  it('classifies unlock, threshold, normal, kard-covered and maxed copies', () => {
    const s = setup([card('new', 0), card('low', F(1)), card('mid', F(5)), card('max', F(10))], [], (s) => (s.rarities[0].fusionUpKards = 7));
    const ctx = buildCtx(s);
    const c = (id: string) => ctx.cards.get(id)!;
    expect(copyPhase(ctx, c('new'))).toBe('unlock');
    expect(copyPhase(ctx, c('low'))).toBe('toThreshold');
    expect(copyPhase(ctx, c('mid'))).toBe('normal'); // 5 to max; 7 kards buy F5→F6 (3) + F6→F7 (4), covering 2
    expect(copyPhase(ctx, c('mid'), 3)).toBe('kardCovered');
    expect(copyPhase(ctx, c('max'))).toBe('maxed');
  });

  it('charges the Diamond kard curve per step', () => {
    const diamond = rules().get('diamond')!;
    expect([3, 4, 5, 6, 7, 8, 9].map((f) => kardCost(diamond, F(f)))).toEqual([1, 2, 3, 4, 5, 7, 10]);
    expect(kardCost(diamond, F(2))).toBeNull(); // below the F3 threshold
    expect(kardCost(diamond, F(10))).toBeNull(); // already F10
    // 10 kards: exactly F9 → F10 when that's the only card.
    const s = setup([card('near', F(9))], [], (s) => (s.rarities[0].fusionUpKards = 10));
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [{ cardId: 'near', from: F(9), to: F(10), kards: 10 }], left: 0 });
  });

  it("spends Gold kards on ascension too, up to the card's own cap", () => {
    const gold = rules().get('gold')!;
    expect(kardCost(gold, F(10))).toBe(10); // F10 → A1
    expect(kardCost(gold, A(9))).toBe(10); // A9 → A10
    expect(kardCost(gold, A(10))).toBeNull(); // already A10
    // 25 kards on a card capped at A2: F9→F10 (10), F10→A1 (10); A1→A2 (10) doesn't fit. 5 left over.
    const s = setup([card('g', F(9), { rarityId: 'gold', maxLevel: A(2) })], [], (s) => (s.rarities[1].fusionUpKards = 25));
    expect(buildCtx(s).kardPlan.get('gold')).toEqual({ assignments: [{ cardId: 'g', from: F(9), to: A(1), kards: 20 }], left: 5 });
  });

  it('extends older Gold kard tables through ascension, keeping edited fusion costs', () => {
    const s = defaultState();
    const gold = s.rarities.find((r) => r.id === 'gold')!;
    gold.kardsPerLevel = [0, 0, 0, 2, 2, 3, 4, 5, 7, 10];
    const out = normalize(s).rarities.find((r) => r.id === 'gold')!;
    expect(out.kardsPerLevel.slice(0, 4)).toEqual([0, 0, 0, 2]);
    expect(out.kardsPerLevel).toHaveLength(20);
  });

  it('spends kards on the cheapest steps first, weighting guest cards', () => {
    // Costs: F4→F5 2, F5→F6 3, F6→F7 4, F8→F9 7. Guest steps count 1.5×, so guest F4→F6 (5 kards), then
    // the plain F4→F5 (2) beats the guest's F6→F7 (4); the near-max card's 7-kard step never wins. 1 left over.
    const s = setup([card('far', F(4)), card('near', F(8)), card('guest', F(4), { guest: true })], [], (s) => (s.rarities[0].fusionUpKards = 8));
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({
      assignments: [
        { cardId: 'guest', from: F(4), to: F(6), kards: 5 },
        { cardId: 'far', from: F(4), to: F(5), kards: 2 },
      ],
      left: 1,
    });
  });
});

describe('scoring', () => {
  it('values a copy that reaches F3 more than one past it', () => {
    const s = setup([card('low', F(1)), card('high', F(5))], [pack('a', [{ cardId: 'low', chance: 10 }]), pack('b', [{ cardId: 'high', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeGreaterThan(packEV(ctx, s.packs[1]));
  });

  it('boosts guest cards', () => {
    const s = setup([card('g', F(5), { guest: true }), card('n', F(5))], [pack('a', [{ cardId: 'g', chance: 10 }]), pack('b', [{ cardId: 'n', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeCloseTo(packEV(ctx, s.packs[1]) * 1.5);
  });

  it('ignores maxed cards', () => {
    const s = setup([card('m', F(10))], [pack('a', [{ cardId: 'm', chance: 50 }])]);
    expect(packEV(buildCtx(s), s.packs[0])).toBe(0);
  });
});

describe('planner', () => {
  it('stays within budget and purchase limits, and prefers expiring packs', () => {
    const s = setup(
      [card('a', F(5)), card('b', F(5))],
      [
        pack('perm', [{ cardId: 'a', chance: 10 }]),
        pack('limited', [{ cardId: 'b', chance: 10 }], { endsAt: '2026-01-12T00:00', maxPurchases: 2 }),
        pack('gone', [{ cardId: 'a', chance: 90 }], { endsAt: '2026-01-01T00:00' }),
      ],
      (s) => (s.currencies[0].balance = 350),
    );
    const plan = buildPlan(buildCtx(s), NOW);
    const souls = plan.currencies.find((c) => c.currencyId === 'souls')!;
    expect(souls.spent).toBeLessThanOrEqual(350);
    expect(souls.buys.map((b) => [b.pack.id, b.count])).toEqual([
      ['limited', 2],
      ['perm', 1],
    ]);
    expect(souls.saveFor?.pack.id).toBe('perm');
    expect(souls.saveFor?.shortBy).toBe(50);
  });

  it('stops buying once expected copies would max the card', () => {
    const s = setup([card('a', F(9))], [pack('p', [{ cardId: 'a', chance: 100 }])], (s) => (s.currencies[0].balance = 1000));
    const souls = buildPlan(buildCtx(s), NOW).currencies[0];
    expect(souls.buys[0].count).toBe(1);
  });
});

describe('removing done cards', () => {
  it('drops cards at their goal, their pack drops, and store items that only sold them', () => {
    const s = setup(
      [card('maxed', F(10)), card('capped', A(5), { rarityId: 'gold', maxLevel: A(5) }), card('epic', F(3), { rarityId: 'epic' }), card('open', F(2))],
      [
        pack('store', [{ cardId: 'maxed', chance: 100 }], { store: true }),
        pack('random', [{ cardId: 'maxed', chance: 20 }, { cardId: 'open', chance: 5 }]),
      ],
    );
    expect(pruneDone(s).sort()).toEqual(['capped', 'epic', 'maxed']);
    expect(s.cards.map((c) => c.id)).toEqual(['open']);
    expect(s.packs.map((p) => p.id)).toEqual(['random']);
    expect(s.packs[0].drops).toEqual([{ cardId: 'open', chance: 5 }]);
  });

  it('leaves everything alone when nothing is done', () => {
    const s = setup([card('open', F(2))], [pack('p', [{ cardId: 'open', chance: 5 }])]);
    expect(pruneDone(s)).toEqual([]);
    expect(s.cards).toHaveLength(1);
  });
});

describe('Realm Klash seasons', () => {
  it('rolls the season end forward 2 weeks at a time', () => {
    expect(seasonEnd(null, NOW)).toBeNull();
    expect(seasonEnd('2026-01-12T20:00', NOW)).toBe('2026-01-12T20:00'); // still running
    expect(seasonEnd('2026-01-10T11:00', NOW)).toBe('2026-01-24T11:00'); // ended an hour ago
    expect(seasonEnd('2025-12-01T20:00', NOW)).toBe('2026-01-12T20:00'); // three seasons later
  });

  it('ends a season early: its items expire, older seasons keep their dates, and the next season runs 2 weeks', () => {
    const s = setup([], [
      pack('now', [], { season: true, endsAt: '2026-01-12T20:00' }),
      pack('last', [], { season: true, endsAt: '2025-12-29T20:00' }),
      pack('gear', [], { season: false, endsAt: null }),
    ], (s) => (s.realmKlashSeasonEnd = '2025-12-29T20:00'));
    moveSeasonEnd(s, '2026-01-10T11:59', NOW);
    expect(s.packs.map((p) => p.endsAt)).toEqual(['2026-01-10T11:59', '2025-12-29T20:00', null]);
    expect(packStatus(s.packs[0], NOW)).toBe('expired');
    expect(seasonEnd(s.realmKlashSeasonEnd, NOW)).toBe('2026-01-24T11:59');
  });

  it('assumes Blood Ruby characters, Kameos and Kameo packs rotate, but not the gear', () => {
    const s = setup([card('hero', F(2)), card('gear', F(5), { rarityId: 'epic', goal: 'max' }), card('kameo', 0, { rarityId: 'kameo-gold' })]);
    const item = (cardId: string) => pack(cardId, [{ cardId, chance: 100 }], { currencyId: 'blood-rubies', store: true });
    expect(suggestSeason(item('hero'), s)).toBe(true);
    expect(suggestSeason(item('kameo'), s)).toBe(true);
    expect(suggestSeason(item('gear'), s)).toBe(false);
    expect(suggestSeason(pack('kameo pack', [], { currencyId: 'blood-rubies' }), s)).toBe(true);
    expect(suggestSeason(pack('souls pack', []), s)).toBe(false);
  });
});
