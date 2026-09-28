import { describe, expect, it } from 'vitest';
import { parseCardList } from './cardList';
import { defaultState } from './defaults';
import type { Card } from './types';

const rarities = defaultState().rarities;

describe('pasted card lists', () => {
  it('switches rarity at heading lines and skips underlines and blanks', () => {
    const text = 'Gold Kameo\n----------------------\nJade, Lizard\n\nDiamond Kameo\n-------------------------\nGeras, MK1\n';
    expect(parseCardList(text, rarities, 'diamond', []).cards).toEqual([
      { name: 'Jade, Lizard', rarityId: 'kameo-gold' },
      { name: 'Geras, MK1', rarityId: 'kameo-diamond' },
    ]);
  });

  it('uses the picked rarity until a heading, and skips cards already listed', () => {
    const existing: Card[] = [{ id: 'x', name: 'Scorpion MK2 Movie', rarityId: 'kameo-diamond', fusion: 0, guest: false }];
    const r = parseCardList('Scorpion, MKII Movie\nSub-Zero, MK1\nsub-zero, mk1\nGold:\nKano, Commando', rarities, 'kameo-diamond', existing);
    expect(r.cards).toEqual([
      { name: 'Sub-Zero, MK1', rarityId: 'kameo-diamond' },
      { name: 'Kano, Commando', rarityId: 'gold' },
    ]);
    expect(r.duplicates).toEqual(['Scorpion, MKII Movie', 'sub-zero, mk1']);
  });
});
