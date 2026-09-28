import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import {
  buildCtx, buildPlan, copiesAtFusion, copiesToMax, copiesToThreshold, copyPhase, fLevel as F, isMaxed, levelLabel, packEV, pruneDone, targetLevel,
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

describe('save migration', () => {
  it('shifts version-1 levels (first copy = F1) to F0-based storage', () => {
    const v1 = { version: 1, rarities: [], currencies: [], packs: [], cards: [card('a', 2, { maxLevel: 15 }), card('b', 0)] };
    const s = normalize(v1);
    expect(s.version).toBe(2);
    expect(s.cards.map((c) => [c.fusion, c.maxLevel])).toEqual([[3, 16], [0, undefined]]);
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
    const s = setup([card('new', 0), card('low', F(1)), card('mid', F(5)), card('max', F(10))], [], (s) => (s.rarities[0].fusionUpKards = 2));
    const ctx = buildCtx(s);
    const c = (id: string) => ctx.cards.get(id)!;
    expect(copyPhase(ctx, c('new'))).toBe('unlock');
    expect(copyPhase(ctx, c('low'))).toBe('toThreshold');
    expect(copyPhase(ctx, c('mid'))).toBe('normal'); // 5 to max, kards cover last 2
    expect(copyPhase(ctx, c('mid'), 3)).toBe('kardCovered');
    expect(copyPhase(ctx, c('max'))).toBe('maxed');
  });

  it('gives kards to guest cards first, then the ones closest to max', () => {
    const s = setup([card('far', F(4)), card('near', F(8)), card('guest', F(4), { guest: true })], [], (s) => (s.rarities[0].fusionUpKards = 8));
    const plan = buildCtx(s).kardPlan.get('diamond')!;
    expect(plan).toEqual([
      { cardId: 'guest', from: F(4), to: F(10) },
      { cardId: 'near', from: F(8), to: F(10) },
    ]);
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
