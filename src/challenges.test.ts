import { describe, expect, it } from 'vitest';
import { applyRarityFix, isChallengeKameo } from './challenges';
import { buildCtx, packEV } from './engine';
import { defaultState } from './defaults';
import { normalize } from './normalize';
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

  describe('moving a Kameo to the site rarity', () => {
    const rules = defaultState().rarities;
    const moved = (card: Card, to: string) => {
      applyRarityFix(card, to, rules);
      return card;
    };

    it('tags a challenge Kameo moved into Gold Kameo', () => {
      expect(moved(kameo('Kotal Kahn, Dark Lord', 'kameo-diamond'), 'kameo-gold')).toMatchObject({ rarityId: 'kameo-gold', source: 'challenge' });
    });

    it('untags one moved out of Gold Kameo', () => {
      const card = moved(kameo('Kotal Kahn, Dark Lord', 'kameo-gold', { source: 'challenge' }), 'kameo-diamond');
      expect(card.rarityId).toBe('kameo-diamond');
      expect(card.source).toBeUndefined();
    });

    it('leaves a Kameo that is not on the challenge list untagged', () => {
      expect(moved(kameo('Jade, Lizard', 'kameo-diamond'), 'kameo-gold').source).toBeUndefined();
    });

    it('keeps a source the Kameo already has', () => {
      // An older paste could tag a Kameo as Krypt gear; that stays until the user clears it.
      expect(moved(kameo('Kotal Kahn, Dark Lord', 'kameo-diamond', { source: 'krypt' }), 'kameo-gold').source).toBe('krypt');
      expect(moved(kameo('Kotal Kahn, Dark Lord', 'kameo-gold', { source: 'krypt' }), 'kameo-diamond').source).toBe('krypt');
    });

    it('forgets a rarity kept earlier', () => {
      expect(moved(kameo('Jade, Lizard', 'kameo-diamond', { keptRarity: 'kameo-gold' }), 'kameo-gold').keptRarity).toBeUndefined();
    });
  });
});
