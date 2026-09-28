import { describe, expect, it } from 'vitest';
import { characterFileMatches, characterTitle } from './wiki';

describe('wiki matching', () => {
  it('maps card names to wiki page titles', () => {
    expect(characterTitle('Scorpion, MKII Movie')).toBe('Scorpion/MK2 Movie');
    expect(characterTitle('Sub-Zero, Kold')).toBe('Sub-Zero/Kold War');
  });

  it('accepts art files with the name and variant, and skips ability icons and pack banners', () => {
    expect(characterFileMatches('Raiden, Injustice 2', 'File:Injustice 2 Raiden.png')).toBe(true);
    expect(characterFileMatches('Sub-Zero, MK1', 'File:MK1 Sub-Zero.png')).toBe(true);
    expect(characterFileMatches('Sub-Zero, MK1', "File:MK1 Sub-Zero's passive.png")).toBe(false);
    expect(characterFileMatches('Raiden, Injustice 2', 'File:Injustice 2 Raiden Pack.jpg')).toBe(false);
    expect(characterFileMatches('Sub-Zero, MK1', 'File:MK11 Sub-Zero.png')).toBe(false);
  });
});
