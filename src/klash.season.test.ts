import { describe, expect, it } from 'vitest';
import season from './klash.season.json';
import { FLOORS, buildTower, klashKey, type KlashItem } from './klash';

// klash.season.json is a snapshot of the MK Mobile Base catalog (every character and Kameo, so strength is scaled and
// effect tags are read as in the app, plus this pool's gear), and the 105-card Realm Klash pool the user listed on
// 2026-11-14. The test pins the tower it builds, so a change to the builder or its weights shows up here as a diff to
// read and accept. When the weights are tuned on purpose, update the expected floors below.
const items = season.items as KlashItem[];
const pool = season.pool.map((p) => {
  const [kind, name] = p.split('|');
  return klashKey({ kind: kind as KlashItem['kind'], name });
});

describe("Klash Tower: the user's 2026-11 season pool", () => {
  const tower = buildTower(items, pool);

  // Value: protects=the real season pool builds this tower (teams and Kameos per floor); fails_when=a builder or weight
  // change moves cards between floors unnoticed; why_new=the eng review asked for a fixed tower from a real pool;
  // seam=none; no_claim=whether this is the best tower in game (the weights are starting guesses)
  it('builds the expected teams and Kameos on every floor', () => {
    expect(tower.floors.map((f) => [f.rule.floor, f.fighters.map((x) => x.item.name), f.kameo?.item.name])).toEqual([
      [1, ['Jason Voorhees Unstoppable', 'Quan Chi Warlock', 'Triborg Sub-Zero (LK-52O)'], 'Kung Jin - Shaolin'],
      [2, ['Jade Klassic', 'Shang Tsung Klassic', 'Tanya Pyromancer'], 'Reptile - Nimble'],
      [3, ['Mileena MK1', 'Skarlet MK11', 'Sub-Zero MK1'], 'Jacqui Briggs - High Tech'],
      [4, ['Kitana Circle of Shadow', 'Kung Lao Circle of Shadow', 'Sub-Zero Circle of Shadow'], 'Noob Saibot - MK11'],
      [5, ['Kabal Black Dragon', 'Kano Black Dragon', 'Tremor Black Dragon'], 'Johnny Cage - Strike Force'],
    ]);
    expect([tower.missing, tower.noSlot.map((c) => c.name), tower.floors.flatMap((f) => f.short)]).toEqual([[], ["Takahashi's Determination"], []]);
  });

  // Value: protects=on a real pool every hard rule holds at once: each card once, rarities and fusion per floor, gear
  // slots with the Diamond extra, Rare-only floors 1 and 2, no own Friendship+Brutality mix, no exact-version Kameo;
  // fails_when=any rule breaks only on a pool this size (the made-up pools in klash.test.ts are small); why_new=as above;
  // seam=none; no_claim=none beyond protects
  it('keeps every game rule on the real pool', () => {
    const placed = tower.floors.flatMap((f) => [...f.fighters.flatMap((x) => [x.item, ...x.gear.map((g) => g.item)]), ...(f.kameo ? [f.kameo.item] : [])]);
    expect(new Set(placed).size).toBe(placed.length);
    for (const f of tower.floors) {
      const rule = FLOORS[f.rule.floor - 1];
      for (const x of f.fighters) {
        expect(rule.characters[x.item.rarity as 'gold' | 'diamond']).toBe(x.level);
        const base = x.gear.filter((g) => !g.extra).map((g) => g.slot);
        expect(base.sort()).toEqual(['accessory', 'armor', 'weapon']);
        expect(x.gear.filter((g) => g.extra).length).toBe(x.item.rarity === 'diamond' ? 1 : 0);
        for (const g of x.gear) expect(rule.gear[g.item.rarity as 'rare' | 'epic']).toBeTruthy();
        const own = (k: string) => x.gear.some((g) => g.item.set === k && (g.item.setFor ?? []).includes(x.item.name));
        expect(own('friendship') && own('brutality')).toBe(false);
        expect(f.kameo && klashKey({ kind: 'character', name: f.kameo.item.name }) === klashKey(x.item)).toBeFalsy();
      }
      expect(f.kameo?.item.rarity).toBe(rule.kameo);
    }
  });
});
