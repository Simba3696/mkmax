import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import {
  buildCtx, buildPlan, copiesAtFusion, copiesToMax, copiesToThreshold, copyPhase, isMaxed, levelLabel, packEV, stepCopy, targetLevel,
} from './engine';
import type { AppState, Card, Pack } from './types';

const NOW = new Date('2026-01-10T12:00:00');

function setup(cards: Card[], packs: Pack[] = [], tweak?: (s: AppState) => void) {
  const s = defaultState();
  s.cards = cards;
  s.packs = packs;
  tweak?.(s);
  return s;
}

const card = (id: string, fusion: number, extra: Partial<Card> = {}): Card => ({ id, name: id, rarityId: 'diamond', fusion, tier: 'want', guest: false, ...extra });
const pack = (id: string, drops: Pack['drops'], extra: Partial<Pack> = {}): Pack => ({
  id, name: id, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops, ...extra,
});

describe('fusion math', () => {
  it('counts copies with 1 dupe per level', () => {
    const rule = defaultState().rarities[0];
    expect(copiesAtFusion(rule, 0)).toBe(0);
    expect(copiesAtFusion(rule, 1)).toBe(1);
    expect(copiesAtFusion(rule, 10)).toBe(10);
    expect(copiesToThreshold(card('a', 1), rule)).toBe(2);
    expect(copiesToThreshold(card('a', 5), rule)).toBe(0);
  });
});

describe('goals and caps', () => {
  const rules = () => new Map(defaultState().rarities.map((r) => [r.id, r]));

  it('caps gold at the per-card ascension level', () => {
    const gold = rules().get('gold')!;
    const a5 = card('g', 11, { rarityId: 'gold', maxLevel: 15 }); // A1, cap A5
    expect(levelLabel(gold, 11)).toBe('A1');
    expect(targetLevel(a5, gold)).toBe(15);
    expect(copiesToMax(a5, gold)).toBe(4);
    expect(copiesToMax(card('g', 16, { rarityId: 'gold' }), gold)).toBe(4); // A6 → A10
  });

  it('tracks threshold-goal equipment only until F3, counting spare dupes', () => {
    const epic = rules().get('epic')!;
    expect(copiesToMax(card('e', 0, { rarityId: 'epic' }), epic)).toBe(4);
    expect(copiesToMax(card('e', 2, { rarityId: 'epic', spare: 1 }), epic)).toBe(1);
    expect(isMaxed(card('e', 3, { rarityId: 'epic' }), epic)).toBe(true);
  });

  it('steps copies through levels that need more than one dupe', () => {
    const epic = rules().get('epic')!;
    let c = card('e', 0, { rarityId: 'epic' });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      c = { ...c, ...stepCopy(c, epic, 1) };
      seen.push(`${c.fusion}+${c.spare}`);
    }
    expect(seen).toEqual(['1+0', '2+0', '2+1', '3+0']);
    c = { ...c, ...stepCopy(c, epic, -1) };
    expect([c.fusion, c.spare]).toEqual([2, 1]);
  });
});

describe('phases', () => {
  it('classifies unlock, threshold, normal, kard-covered and maxed copies', () => {
    const s = setup([card('new', 0), card('low', 2), card('mid', 5), card('max', 10)], [], (s) => (s.rarities[0].fusionUpKards = 2));
    const ctx = buildCtx(s);
    const c = (id: string) => ctx.cards.get(id)!;
    expect(copyPhase(ctx, c('new'))).toBe('unlock');
    expect(copyPhase(ctx, c('low'))).toBe('toThreshold');
    expect(copyPhase(ctx, c('mid'))).toBe('normal'); // 5 to max, kards cover last 2
    expect(copyPhase(ctx, c('mid'), 3)).toBe('kardCovered');
    expect(copyPhase(ctx, c('max'))).toBe('maxed');
  });

  it('gives kards to higher-priority cards first', () => {
    const s = setup([card('nice', 8, { tier: 'nice' }), card('must', 4, { tier: 'must' })], [], (s) => (s.rarities[0].fusionUpKards = 3));
    const plan = buildCtx(s).kardPlan.get('diamond')!;
    expect(plan).toEqual([{ cardId: 'must', from: 4, to: 7 }]);
  });
});

describe('scoring', () => {
  it('values a copy that reaches F3 more than one past it', () => {
    const s = setup([card('low', 2), card('high', 5)], [pack('a', [{ cardId: 'low', chance: 10 }]), pack('b', [{ cardId: 'high', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeGreaterThan(packEV(ctx, s.packs[1]));
  });

  it('boosts guest cards', () => {
    const s = setup([card('g', 5, { guest: true }), card('n', 5)], [pack('a', [{ cardId: 'g', chance: 10 }]), pack('b', [{ cardId: 'n', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeCloseTo(packEV(ctx, s.packs[1]) * 1.5);
  });

  it('ignores skipped and maxed cards', () => {
    const s = setup([card('s', 3, { tier: 'skip' }), card('m', 10)], [pack('a', [{ cardId: 's', chance: 50 }, { cardId: 'm', chance: 50 }])]);
    expect(packEV(buildCtx(s), s.packs[0])).toBe(0);
  });
});

describe('planner', () => {
  it('stays within budget and purchase limits, and prefers expiring packs', () => {
    const s = setup(
      [card('a', 5), card('b', 5)],
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
    const s = setup([card('a', 9)], [pack('p', [{ cardId: 'a', chance: 100 }])], (s) => (s.currencies[0].balance = 1000));
    const souls = buildPlan(buildCtx(s), NOW).currencies[0];
    expect(souls.buys[0].count).toBe(1);
  });
});
