import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import { decideSync } from './sync';

const at = (updatedAt?: number) => ({ ...defaultState(), updatedAt });
/** A copy with a card in it, so it isn't the empty data of a device that has just been set up. */
const withCard = (updatedAt?: number) => ({ ...at(updatedAt), cards: [{ id: 'c1', name: 'Klassic Sub-Zero', rarityId: 'diamond', fusion: 1, guest: false }] });

describe('decideSync', () => {
  it('pushes when the gist is empty', () => {
    expect(decideSync(null, at(5), 0)).toBe('push');
  });

  it('pulls when only the other device changed', () => {
    expect(decideSync(at(20), at(10), 10)).toBe('pull');
  });

  it('pushes when only this device changed', () => {
    expect(decideSync(at(10), at(20), 10)).toBe('push');
  });

  it('asks the user when both changed', () => {
    expect(decideSync(at(30), at(20), 10)).toBe('conflict');
    // A device joining an existing gist (base 0) with its own data also asks.
    expect(decideSync(at(30), withCard(20), 0)).toBe('conflict');
  });

  it('takes the gist copy without asking on a device that has never synced and has no cards or packs', () => {
    // The app saves the season end from the schedule by itself, so a new device can have a stamp of its own.
    expect(decideSync(withCard(30), at(20), 0)).toBe('pull');
    expect(decideSync(withCard(30), at(40), 0)).toBe('pull');
    // Once a device has synced, an emptied copy (Erase everything) is a real change and still asks.
    expect(decideSync(withCard(30), at(20), 10)).toBe('conflict');
  });

  it('does nothing when both are already the same version', () => {
    expect(decideSync(at(10), at(10), 10)).toBe('none');
    expect(decideSync(at(20), at(20), 10)).toBe('none');
  });

  it('never pulls data from a build that shifted levels (version 2 or lower), even if it is newer', () => {
    const old = { ...at(30), version: 2 } as unknown as ReturnType<typeof at>;
    expect(decideSync(old, at(20), 10)).toBe('outdated');
    expect(decideSync(old, at(10), 10)).toBe('outdated');
  });
});
