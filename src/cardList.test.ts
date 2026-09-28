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

  it('reads rarity, source and level after " - ", in any order', () => {
    const text = [
      'Kori Blade - Epic - Lin Kuei Tower - F2',
      'Man in Control - Krypt Gear - Epic - Unowned',
      'Frost Axe - Rare - F0',
      'Carnival Swirl - Uncommon - Twisted Tower - F6',
    ].join('\n');
    expect(parseCardList(text, rarities, 'diamond', []).cards).toEqual([
      { name: 'Kori Blade', rarityId: 'epic', fusion: 3, source: 'tower', sourceNote: 'Lin Kuei Tower' },
      { name: 'Man in Control', rarityId: 'epic', fusion: 0, source: 'krypt' },
      { name: 'Frost Axe', rarityId: 'rare', fusion: 1 },
      { name: 'Carnival Swirl', rarityId: 'uncommon', fusion: 7, source: 'tower', sourceNote: 'Twisted Tower' },
    ]);
  });

  it('updates cards already listed, and explains the lines it skips', () => {
    const existing: Card[] = [{ id: 'k', name: 'Kori Blade', rarityId: 'epic', fusion: 1, guest: false }];
    const text = [
      'Kori Blade - Epic - Lin Kuei Tower - F2',
      'Black Dragon Sword - Common - Black Dragon Tower - F8',
      'Frost Orb - Epic - Lin Kuei Tower - F11',
      "Soul Reaver's Servant - Sorcerer's Tower - Unowned",
      'Psych Bomb - Epic - Black Dragon Tower - Soon',
    ].join('\n');
    const r = parseCardList(text, rarities, 'epic', existing);
    expect(r.cards).toEqual([]);
    expect(r.updates).toEqual([{ cardId: 'k', name: 'Kori Blade', patch: { fusion: 3, source: 'tower', sourceNote: 'Lin Kuei Tower' } }]);
    expect(r.problems.map((p) => p.reason)).toEqual([
      'Common gear isn’t tracked',
      'F11 is past this rarity’s max',
      'No rarity (e.g. Epic, Rare)',
      '"Soon" isn’t a rarity, source or level',
    ]);
  });
});
