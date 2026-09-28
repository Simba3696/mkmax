import { describe, expect, it } from 'vitest';
import { appRarityId, findInCatalog, nameKey, type CatalogItem } from './catalog';
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
    expect(appRarityId(item('equipment', 'x', 'uncommon'), rules.values())).toBeUndefined(); // not tracked
  });

  it('falls back to a no-variant entry only when the rarity matches', () => {
    expect(find('Jason Voorhees, Nightmare', 'diamond')).toBe('Jason Voorhees');
    expect(find('Jason Voorhees, Nightmare', 'gold')).toBeUndefined();
    expect(find('Jason Voorhees, Slasher', 'gold')).toBe('Jason Voorhees Slasher');
  });
});
