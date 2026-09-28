import { describe, expect, it } from 'vitest';
import { isChallengeKameo } from './challenges';
import { buildCtx, packEV } from './engine';
import { defaultState } from './defaults';
import { normalize } from './store';
import type { Card } from './types';

const kameo = (name: string, rarityId = 'kameo-gold', extra: Partial<Card> = {}): Card => ({ id: name, name, rarityId, fusion: 0, guest: false, ...extra });

describe('challenge Kameos', () => {
  it('matches Gold Kameos of challenge characters only', () => {
    const rules = defaultState().rarities;
    expect(isChallengeKameo(kameo('Kotal Kahn, Dark Lord'), rules)).toBe(true);
    expect(isChallengeKameo(kameo('Triborg, Sub-Zero (LK-52O)'), rules)).toBe(true);
    expect(isChallengeKameo(kameo('Ermac Klassic'), rules)).toBe(false); // retired: its Kameo comes from packs now
    expect(isChallengeKameo(kameo('Jade, Lizard'), rules)).toBe(false); // Jade Klassic is the challenge one
    expect(isChallengeKameo(kameo('Kotal Kahn, Dark Lord', 'kameo-diamond'), rules)).toBe(false);
    expect(isChallengeKameo(kameo('Kotal Kahn, Dark Lord', 'gold'), rules)).toBe(false); // the character, not the Kameo
  });

  it('tags existing ones once when a save is upgraded, and leaves a removed tag alone later', () => {
    const v4 = { ...defaultState(), version: 4, cards: [kameo('Kotal Kahn, Dark Lord'), kameo('Jade, Lizard')] };
    const out = normalize(v4);
    expect(out.cards.map((c) => c.source)).toEqual(['challenge', undefined]);
    out.cards[0].source = undefined;
    expect(normalize(out).cards[0].source).toBeUndefined();
  });

  it('values a Kameo pack mostly for the Kameos no challenge gives', () => {
    const s = defaultState();
    s.cards = [kameo('Kotal Kahn, Dark Lord', 'kameo-gold', { source: 'challenge' }), kameo('Jade, Lizard')];
    const pack = (cardId: string) => ({ id: cardId, name: cardId, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId, chance: 50 }] });
    const ctx = buildCtx(s);
    const challenge = packEV(ctx, pack('Kotal Kahn, Dark Lord'), new Map());
    const other = packEV(ctx, pack('Jade, Lizard'), new Map());
    expect(challenge / other).toBeCloseTo(0.2);
  });

  it('untags a retired challenge Kameo once, when the save is upgraded', () => {
    const v6 = { ...defaultState(), version: 6, cards: [kameo('Ermac, Klassic', 'kameo-gold', { source: 'challenge' }), kameo('Kotal Kahn, Dark Lord', 'kameo-gold', { source: 'challenge' })] };
    expect(normalize(v6).cards.map((c) => c.source)).toEqual([undefined, 'challenge']);
  });
});
