import { describe, expect, it } from 'vitest';
import { appRarityId, catalogImageUpdates, findInCatalog, nameKey, rarityMismatches, type CatalogItem } from './catalog';
import { defaultState } from './defaults';
import type { Card } from './types';

const rules = new Map(defaultState().rarities.map((r) => [r.id, r]));
const item = (kind: CatalogItem['kind'], name: string, rarity: string): CatalogItem => ({ kind, name, rarity, slug: name, image: `${name}.webp` });
const ITEMS = [
  item('character', 'Scorpion MK2 Movie', 'diamond'),
  item('character', 'Sub-Zero Kold War', 'diamond'),
  item('character', 'Jason Voorhees', 'diamond'),
  item('character', 'Jason Voorhees Slasher', 'gold'),
  item('equipment', 'Man in the Sky', 'rare'),
  item('equipment', "Takahashi's Gauntlets", 'epic'),
  item('kameo', 'Baraka - Klassic', 'diamond'),
  item('kameo', 'Cassie Cage - Covert Ops', 'gold'),
];
const card = (name: string, rarityId: string): Card => ({ id: name, name, rarityId, fusion: 1, guest: false });
const find = (name: string, rarityId: string) => findInCatalog(card(name, rarityId), rules.get(rarityId), ITEMS)?.name;

describe('catalog matching', () => {
  it('ignores word order, commas, possessives and MKII vs MK2', () => {
    expect(nameKey('Scorpion, MKII Movie')).toBe(nameKey('Scorpion MK2 Movie'));
    expect(nameKey('Weather Warfare')).toBe(nameKey('Weather Warface')); // the site's spelling
    expect(find('Scorpion, MKII Movie', 'diamond')).toBe('Scorpion MK2 Movie');
    expect(find("Takahashi's Gauntlets", 'epic')).toBe("Takahashi's Gauntlets");
  });

  it('matches "Kold" to the site\'s "Kold War"', () => {
    expect(find('Sub-Zero, Kold', 'diamond')).toBe('Sub-Zero Kold War');
  });

  it('matches equipment even when the app has the wrong rarity, so the rarity can be corrected', () => {
    expect(findInCatalog(card('Man in the Sky', 'epic'), rules.get('epic'), ITEMS)?.rarity).toBe('rare');
  });

  it('matches Kameos by name within the Kameo list only', () => {
    expect(find('Baraka, Klassic', 'kameo-diamond')).toBe('Baraka - Klassic');
    // Found even when entered under the wrong tier, so the rarity check can move it.
    expect(find('Cassie Cage, Covert Ops', 'kameo-diamond')).toBe('Cassie Cage - Covert Ops');
    expect(find('Baraka, Klassic', 'diamond')).toBeUndefined();
  });

  it("maps the site's rarity to the app's rarity of the same kind", () => {
    const all = rules.values();
    expect(appRarityId(item('equipment', 'x', 'rare'), rules.values())).toBe('rare');
    expect(appRarityId(item('kameo', 'x', 'gold'), all)).toBe('kameo-gold');
    expect(appRarityId(item('kameo', 'x', 'diamond'), rules.values())).toBe('kameo-diamond');
    expect(appRarityId(item('equipment', 'x', 'uncommon'), rules.values())).toBe('uncommon');
    expect(appRarityId(item('equipment', 'x', 'common'), rules.values())).toBeUndefined(); // not tracked
  });

  it('falls back to a no-variant entry only when the rarity matches', () => {
    expect(find('Jason Voorhees, Nightmare', 'diamond')).toBe('Jason Voorhees');
    expect(find('Jason Voorhees, Nightmare', 'gold')).toBeUndefined();
    expect(find('Jason Voorhees, Slasher', 'gold')).toBe('Jason Voorhees Slasher');
  });
});

describe('automatic catalog art', () => {
  it('replaces missing and old wiki images, but never a pasted one', () => {
    const cards: Card[] = [
      card('Man in the Sky', 'rare'), // no image
      { ...card('Scorpion, MKII Movie', 'diamond'), imageUrl: 'https://static.wikia.nocookie.net/old.png', wikiTitle: 'Scorpion/MK2 Movie' }, // old wiki art
      { ...card('Sub-Zero, Kold', 'diamond'), imageUrl: 'https://example.com/mine.png' }, // pasted by hand
      { ...card('Unknown Card', 'diamond') }, // not in the catalog
    ];
    const updates = catalogImageUpdates(cards, rules, ITEMS);
    expect([...updates.keys()]).toEqual(['Man in the Sky', 'Scorpion, MKII Movie']);
    expect(updates.get('Scorpion, MKII Movie')).toEqual({ imageUrl: 'Scorpion MK2 Movie.webp', imagePage: expect.stringContaining('mkmobilebase.com'), wikiTitle: undefined });
  });
});


describe('rarity check', () => {
  it("lists cards whose rarity the site gives differently, whether or not they have art", () => {
    const cards: Card[] = [
      { ...card('Man in the Sky', 'epic'), imageUrl: 'Man in the Sky.webp', imagePage: 'https://mkmobilebase.com/x' },
      card('Cassie Cage, Covert Ops', 'kameo-diamond'),
      card('Scorpion, MKII Movie', 'diamond'), // right already
      card('Unknown Card', 'gold'), // not in the catalog
    ];
    expect(rarityMismatches(cards, rules, ITEMS).map((m) => [m.card.name, m.to])).toEqual([
      ['Man in the Sky', 'rare'],
      ['Cassie Cage, Covert Ops', 'kameo-gold'],
    ]);
  });

  it('leaves out a rarity the user kept, until the site gives another one', () => {
    expect(rarityMismatches([{ ...card('Man in the Sky', 'epic'), keptRarity: 'rare' }], rules, ITEMS)).toEqual([]);
    expect(rarityMismatches([{ ...card('Man in the Sky', 'epic'), keptRarity: 'uncommon' }], rules, ITEMS).map((m) => m.to)).toEqual(['rare']);
  });
});
