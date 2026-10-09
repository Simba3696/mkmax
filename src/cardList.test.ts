import { describe, expect, it } from 'vitest';
import { parseCardList } from './cardList';
import { pruneDone } from './engine';
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
      '"Soon" isn’t a rarity, source, level or stage',
    ]);
  });

  it('drops bullets and numbers from the start of a line', () => {
    const text = 'Gold Kameo\n- Jade, Lizard\n• Baraka, Klassic\n* Smoke, Klassic\n2. Kitana, Mournful\n3) Geras, MK1\n– Kori Blade - Epic - F2';
    expect(parseCardList(text, rarities, 'diamond', []).cards).toEqual([
      { name: 'Jade, Lizard', rarityId: 'kameo-gold' },
      { name: 'Baraka, Klassic', rarityId: 'kameo-gold' },
      { name: 'Smoke, Klassic', rarityId: 'kameo-gold' },
      { name: 'Kitana, Mournful', rarityId: 'kameo-gold' },
      { name: 'Geras, MK1', rarityId: 'kameo-gold' },
      { name: 'Kori Blade', rarityId: 'epic', fusion: 3 },
    ]);
  });

  it('tags only gear as Krypt or tower gear', () => {
    const r = parseCardList('Scorpion, Klassic - Gold - Krypt\nJade, Lizard - Gold Kameo - Tower\nKori Blade - Epic - Krypt', rarities, 'diamond', []);
    expect(r.cards).toEqual([{ name: 'Kori Blade', rarityId: 'epic', source: 'krypt' }]);
    expect(r.problems.map((p) => p.reason)).toEqual(['Only gear comes from the Krypt or a tower', 'Only gear comes from the Krypt or a tower']);
  });

  it('reads Stage I and Stage II as a Gold card\'s Max, and adds a missing card back at the cap below', () => {
    const existing: Card[] = [
      { id: 'k', name: 'Kenshi, Elder God', rarityId: 'gold', fusion: 8, guest: false, maxLevel: 11 },
      { id: 's', name: 'Scorpion, Hanzo Hasashi', rarityId: 'gold', fusion: 13, guest: false, maxLevel: 16 },
      { id: 'j', name: 'Jax, Onslaught', rarityId: 'gold', fusion: 18, guest: false },
    ];
    const text = [
      'Kenshi, Elder God - Gold - Stage I', // still being fused: only its Max changes
      'Scorpion, Hanzo Hasashi - Gold - Stage II', // at A2 of A5: Max goes to A10
      'Goro, Tigrar Fury - Gold - Stage I', // not in the app, so maxed at F10 before the update
      'Sub-Zero, Klassic - Gold - Stage II', // maxed at A5 before the update
      'Kitana, Edenian Blood - Gold - Stage I - Unowned', // a level given wins
      'Jax, Onslaught - Gold - Stage I', // already A7: lowering Max would delete it
      'Jade, Klassic - Diamond - Stage I',
    ].join('\n');
    const r = parseCardList(text, rarities, 'diamond', existing);
    expect(r.updates).toEqual([
      { cardId: 'k', name: 'Kenshi, Elder God', patch: { maxLevel: 16 } },
      { cardId: 's', name: 'Scorpion, Hanzo Hasashi', patch: { maxLevel: null } },
    ]);
    expect(r.cards).toEqual([
      { name: 'Goro, Tigrar Fury', rarityId: 'gold', fusion: 11, maxLevel: 16 },
      { name: 'Sub-Zero, Klassic', rarityId: 'gold', fusion: 16, maxLevel: null },
      { name: 'Kitana, Edenian Blood', rarityId: 'gold', fusion: 0, maxLevel: 16 },
    ]);
    expect(r.problems.map((p) => p.reason)).toEqual(['Already A7, past Stage I’s A5', 'Diamond cards don’t have Stage I ascension']);
  });

  it('refuses a stage line for a card filed under another rarity, and keeps stage edge cases safe', () => {
    const existing: Card[] = [
      { id: 'k', name: 'Kenshi, Elder God', rarityId: 'diamond', fusion: 4, guest: false },
      { id: 'g', name: 'Goro, Tigrar Fury', rarityId: 'gold', fusion: 8, guest: false },
    ];
    const text = [
      'Kenshi, Elder God - Gold - Stage I', // filed as Diamond: not a missing (maxed) card
      'Kitana, Edenian Blood - Gold - A7 - Stage I', // a level past the stage's Max
      'Goro, Tigrar Fury - Gold - Stage I',
      'Goro, Tigrar Fury - Gold - Stage II', // listed twice: the first line wins
      'Jax, Onslaught - Stage I', // details with no rarity
      'Sonya Blade, Klassic - Gold - Stage III',
    ].join('\n');
    const r = parseCardList(text, rarities, 'gold', existing);
    expect(r.cards).toEqual([]);
    expect(r.updates).toEqual([{ cardId: 'g', name: 'Goro, Tigrar Fury', patch: { maxLevel: 16 } }]);
    expect(r.duplicates).toEqual(['Goro, Tigrar Fury']);
    expect(r.problems.map((p) => p.reason)).toEqual([
      'Listed as Diamond: change its rarity on the card first',
      'A7 is past Stage I’s A5',
      'No rarity (e.g. Epic, Rare)',
      '"Stage III" isn’t a rarity, source, level or stage',
    ]);
  });

  it('a stage paste keeps a card still being fused, and one exactly at the new Max is maxed', () => {
    const s = defaultState();
    s.cards = [
      { id: 'g', name: 'Goro, Tigrar Fury', rarityId: 'gold', fusion: 8, guest: false },
      { id: 'k', name: 'Kenshi, Elder God', rarityId: 'gold', fusion: 16, guest: false },
    ];
    const r = parseCardList('Goro, Tigrar Fury - Gold - Stage I\nKenshi, Elder God - Gold - Stage I', s.rarities, 'gold', s.cards);
    for (const u of r.updates) Object.assign(s.cards.find((c) => c.id === u.cardId)!, u.patch);
    expect(pruneDone(s)).toEqual(['Kenshi, Elder God']);
    expect(s.cards.map((c) => [c.name, c.maxLevel])).toEqual([['Goro, Tigrar Fury', 16]]);
  });
});
