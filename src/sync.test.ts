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
    expect(decideSync(at(30), withCard(20), 10)).toBe('conflict');
    // A device joining an existing gist (base 0) with its own data also asks.
    expect(decideSync(at(30), withCard(20), 0)).toBe('conflict');
  });

  it('pulls on a new device that has no edits of its own yet', () => {
    // A fresh install isn't stamped, even after the app sets the season end from the schedule.
    expect(decideSync(withCard(30), at(undefined), 0)).toBe('pull');
  });

  it('pushes the first edits of a fresh device that created the gist, which has no stamp', () => {
    expect(decideSync(at(undefined), at(20), 0)).toBe('push');
  });

  it('does nothing when both changed to the same data, like each moving the season end by itself', () => {
    const remote = { ...withCard(30), realmKlashSeasonEnd: '2026-10-21T16:00' };
    const local = { ...withCard(40), realmKlashSeasonEnd: '2026-10-21T16:00' };
    expect(decideSync(remote, local, 10)).toBe('none');
    // Key order doesn't matter.
    const reordered = Object.fromEntries(Object.entries(local).reverse()) as typeof local;
    expect(decideSync(remote, reordered, 10)).toBe('none');
    expect(decideSync(remote, { ...local, realmKlashSeasonEnd: '2026-10-22T16:00' }, 10)).toBe('conflict');
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
