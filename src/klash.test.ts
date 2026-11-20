import { describe, expect, it } from 'vitest';
import { BELOW_F10, FLOORS, buildTower, klashKey, pinFloors, type KlashItem, type Slot } from './klash';

// A small catalog: fighters with stats on a 0..10 scale (attack + health from 0 to 100), so strengths are easy to read.
const char = (name: string, rarity: 'gold' | 'diamond', total: number, extra: Partial<KlashItem> = {}): KlashItem => ({
  kind: 'character',
  name,
  rarity,
  attack: total,
  health: 0,
  tags: [],
  ...extra,
});
const kameo = (name: string, rarity: 'gold' | 'diamond', extra: Partial<KlashItem> = {}): KlashItem => ({ kind: 'kameo', name, rarity, tags: [], ...extra });
const piece = (name: string, rarity: 'rare' | 'epic', slot: Slot | undefined, extra: Partial<KlashItem> = {}): KlashItem => ({
  kind: 'equipment',
  name,
  rarity,
  slot,
  tags: [],
  ...extra,
});
// Anchors for the stat scale: 0 and 100 total, never in a pool.
const anchors = [char('Anchor Low', 'gold', 0), char('Anchor High', 'diamond', 100)];
const keys = (list: KlashItem[]) => list.map(klashKey);
const names = (list: { item: KlashItem }[]) => list.map((f) => f.item.name);

const golds = (n: number, base = 40) => Array.from({ length: n }, (_, i) => char(`Gold ${String.fromCharCode(65 + i)}`, 'gold', base - i));
const diamonds = (n: number, base = 90) => Array.from({ length: n }, (_, i) => char(`Diamond ${String.fromCharCode(65 + i)}`, 'diamond', base - i));
const kameos = () => [kameo('Kameo G1', 'gold'), kameo('Kameo G2', 'gold'), kameo('Kameo G3', 'gold'), kameo('Kameo D1', 'diamond'), kameo('Kameo D2', 'diamond')];

describe('Klash Tower: floor limits', () => {
  // Value: protects=each floor takes only the rarities the game allows there, Diamonds strongest on floor 5, each card
  // once; fails_when=a Gold lands on floor 5, a Diamond on floor 1, or a card is used twice; why_new=new module;
  // seam=none; no_claim=real in-game strength
  it('puts Diamonds on 5, Golds on 1, and every card once', () => {
    const cards = [...anchors, ...golds(10), ...diamonds(16), ...kameos()];
    const pool = keys(cards.filter((c) => !c.name.startsWith('Anchor')));
    const t = buildTower(cards, pool);
    expect(names(t.floors[4].fighters).every((n) => n.startsWith('Diamond'))).toBe(true);
    expect(names(t.floors[0].fighters).every((n) => n.startsWith('Gold'))).toBe(true);
    // The three strongest Diamonds go to floor 5.
    expect(names(t.floors[4].fighters)).toEqual(['Diamond A', 'Diamond B', 'Diamond C']);
    const all = t.floors.flatMap((f) => [...names(f.fighters), f.kameo?.item.name]);
    expect(new Set(all).size).toBe(all.length);
    expect(t.floors.map((f) => f.kameo?.item.rarity)).toEqual(['gold', 'gold', 'gold', 'diamond', 'diamond']);
    expect(t.floors.every((f) => f.short.length === 0)).toBe(true);
  });

  // Value: protects=a Diamond on floors 2 and 3 counts one level below F10; fails_when=the level or the 95% rule is
  // dropped; why_new=new module; seam=none; no_claim=the game's real stat curve
  it('counts a Diamond on floors 2 and 3 at F9, at 95%', () => {
    expect(FLOORS[2].characters).toEqual({ gold: 10, diamond: 9 });
    const cards = [...anchors, char('Only D', 'diamond', 50)];
    const t = buildTower(cards, keys([cards[2]]), { [klashKey(cards[2])]: 3 });
    const f = t.floors[2].fighters[0];
    expect([f.level, f.strength]).toEqual([9, 5 * BELOW_F10]);
  });

  // Value: protects=floors 2 to 4 leave enough Golds for floor 1, which can take nothing else; fails_when=greedy floors
  // take every Gold and floor 1 is short; why_new=new module; seam=none; no_claim=none beyond protects
  it('keeps three Golds for floor 1 even when Golds would win higher floors', () => {
    const cards = [...anchors, ...golds(5, 95), ...diamonds(6, 30), ...kameos()];
    const t = buildTower(cards, keys(cards.slice(2)));
    expect(t.floors[0].fighters).toHaveLength(3);
    expect(t.floors[0].short).toEqual([]);
  });

  // Value: protects=a short pool says what each floor is missing; fails_when=a floor is silently short or the wording
  // breaks; why_new=new module; seam=none; no_claim=none beyond protects
  it('says what a floor is short of', () => {
    const cards = [...anchors, ...diamonds(2)];
    const t = buildTower(cards, keys(cards.slice(2)));
    expect(t.floors[4].short).toEqual(['needs 1 more Diamond character', 'needs a Diamond Kameo']);
    expect(t.floors[0].short).toEqual(['needs 3 more Gold characters', 'needs a Gold Kameo']);
    expect(t.floors[1].short[0]).toBe('needs 3 more Gold or Diamond characters');
  });

  // Value: protects=with only Golds in the pool, floor 1 still gets 3, and a higher floor takes the best spare Gold it
  // can and says what it's short of; fails_when=the short-of-Gold fallback is dropped (floor 4 empty or floor 1 short) or
  // picks a spare Gold by name instead of strength; why_new=no existing test has fewer Golds than the floors want, so the
  // fallback branch never runs; seam=none; no_claim=the right split of Golds between floors in game
  it('fills floor 1 first and gives a higher floor the strongest spare Gold when Golds run short', () => {
    const cards = [...anchors, char('Gold A', 'gold', 10), char('Gold B', 'gold', 11), char('Gold C', 'gold', 12), char('Gold Z', 'gold', 40)];
    const t = buildTower(cards, keys(cards.slice(2)));
    expect(t.floors[0].fighters).toHaveLength(3);
    expect(t.floors[0].short).toEqual(['needs a Gold Kameo']);
    expect(names(t.floors[3].fighters)).toEqual(['Gold Z']);
    expect(t.floors[3].short[0]).toBe('needs 2 more Gold or Diamond characters');
    expect([t.floors[1].fighters, t.floors[2].fighters]).toEqual([[], []]);
  });
});

describe('Klash Tower: the exact-version rule', () => {
  // Value: protects=a character and Kameo of the exact same version never share a floor, while two versions of one
  // fighter may; fails_when=nameKey matching breaks ("Baraka - Lizard" vs "Baraka Lizard") or the rule blocks other
  // versions; why_new=new module; seam=none; no_claim=none beyond protects
  it('keeps a Kameo off the floor of its exact version, and allows two versions of a fighter', () => {
    const cards = [
      ...anchors,
      char('Baraka Lizard', 'diamond', 99, { class: ['Outworld'] }),
      char('Baraka Klassic', 'diamond', 98, { class: ['Outworld'] }),
      char('Diamond X', 'diamond', 97),
      kameo('Baraka - Lizard', 'diamond', { class: ['Outworld'] }),
      kameo('Plain Kameo', 'diamond'),
    ];
    const t = buildTower(cards, keys(cards.slice(2)));
    expect(names(t.floors[4].fighters)).toEqual(['Baraka Klassic', 'Baraka Lizard', 'Diamond X']);
    expect(t.floors[4].kameo?.item.name).toBe('Plain Kameo');
    expect(t.floors[3].kameo?.item.name).toBe('Baraka - Lizard');
  });
});

describe('Klash Tower: scoring', () => {
  // Value: protects=each synergy term adds its points and shows as a reason; fails_when=a term is dropped, doubled or
  // scored for a no-data fighter; why_new=new module; seam=none; no_claim=whether the weights are right in game
  it('adds Team Passive, pairing, team and class points, and lists them as reasons', () => {
    const a = char('Cup A', 'diamond', 50, { team: 'Kombat Cup', class: ['Spec Ops'], passive: 'All Kombat Cup characters gain power.' });
    const b = char('Cup B', 'diamond', 50, { team: 'Kombat Cup', class: ['Spec Ops'], goodWith: ['Cup A'] });
    const c = char('Loner', 'diamond', 50);
    const cards = [...anchors, a, b, c];
    const t = buildTower(cards, keys([a, b, c]));
    const f5 = t.floors[4];
    // Cup A's passive covers Cup B (+3); Cup B has no passive text, so its own team covers Cup A (+3); a pairing (+2);
    // a shared team (+1); a shared class (+0.5). Loner shares nothing.
    expect(f5.reasons.map((r) => r.points)).toEqual([3, 3, 2]);
    expect(f5.score).toBe(15 + 9.5);
    expect(f5.reasons[2].text).toBe('Cup A and Cup B are a known good pairing');
  });

  // Value: protects=a fighter with no stats scores as the middle fighter of its rarity, with no synergy; fails_when=it
  // scores 0 (never picked) or earns synergy from data it doesn't have; why_new=new module; seam=none; no_claim=none
  it('scores a no-data fighter from its rarity alone', () => {
    const cards = [...anchors, char('D1', 'diamond', 80), char('D2', 'diamond', 60), char('D3', 'diamond', 40), { kind: 'character', name: 'Mystery', rarity: 'diamond' } as KlashItem];
    const t = buildTower(cards, keys(cards.slice(2)));
    const mystery = t.floors.flatMap((f) => f.fighters).find((f) => f.item.name === 'Mystery')!;
    expect(mystery.noData).toBe(true);
    // Middle Diamond (of 100, 80, 60, 40 by stats): 80 sorted ascending [40,60,80,100] → index 2 → 8.
    expect(mystery.strength).toBe(8);
  });

  // Value: protects=a fighter with no stats takes part in no synergy term, in either direction, even when its team,
  // class and Good With list match a teammate's; fails_when=synergy() scores every trio member instead of only those
  // with stats, so a no-data fighter wins floors on team data it may not have; why_new=the no-data test above checks
  // only strength; seam=none; no_claim=whether no-data cards should earn synergy once the catalog fills in
  it('gives a no-data fighter no synergy with its teammates', () => {
    const cup = { team: 'Kombat Cup', class: ['Spec Ops'] };
    const a = char('Cup A', 'diamond', 50, { ...cup, passive: 'All Kombat Cup characters gain power.', goodWith: ['Mystery'] });
    const mystery: KlashItem = { kind: 'character', name: 'Mystery', rarity: 'diamond', tags: [], ...cup, goodWith: ['Cup A'] };
    const c = char('Loner', 'diamond', 50);
    const cards = [...anchors, a, mystery, c];
    const f5 = buildTower(cards, keys([a, mystery, c])).floors[4];
    expect(names(f5.fighters)).toEqual(['Cup A', 'Loner', 'Mystery']);
    expect(f5.reasons).toEqual([]);
    expect(f5.score).toBe(5 + 5 + f5.fighters.find((f) => f.item.name === 'Mystery')!.strength);
  });

  // Value: protects=the community score nudges only with enough votes; fails_when=two votes move the pick, or the nudge
  // is ignored; why_new=new module; seam=none; no_claim=none beyond protects
  it('nudges by the community score only at 3 or more votes', () => {
    const cards = [...anchors, char('Voted', 'diamond', 50, { score: 5, votes: 3 }), char('Few votes', 'diamond', 50, { score: 5, votes: 2 })];
    const t = buildTower(cards, keys(cards.slice(2)));
    const by = Object.fromEntries(t.floors[4].fighters.map((f) => [f.item.name, f.strength]));
    expect(by).toEqual({ Voted: 6, 'Few votes': 5 });
  });

  // Value: protects=the same pool builds the same tower whatever its order; fails_when=a tie depends on pool order;
  // why_new=floors are derived on every device, not saved; seam=none; no_claim=none beyond protects
  it('breaks ties by name, whatever the pool order', () => {
    const cards = [...anchors, ...['Zed', 'Amy', 'Moe', 'Kit'].map((n) => char(n, 'diamond', 50))];
    const pool = keys(cards.slice(2));
    const a = buildTower(cards, pool);
    const b = buildTower(cards, [...pool].reverse());
    expect(names(a.floors[4].fighters)).toEqual(['Amy', 'Kit', 'Moe']);
    expect(names(b.floors[4].fighters)).toEqual(names(a.floors[4].fighters));
  });
});

describe('Klash Tower: gear', () => {
  const fighters = [...anchors, char('Hero', 'diamond', 90), char('Side One', 'diamond', 80), char('Side Two', 'diamond', 70)];

  // Value: protects=one weapon, armor and accessory each, plus one extra piece on a Diamond, and never a slotless
  // piece; fails_when=two weapons as base gear, no extra for a Diamond, or a slotless piece placed; why_new=new module;
  // seam=none; no_claim=none beyond protects
  it('gives each fighter one piece per slot, a Diamond an extra one, and never places slotless gear', () => {
    const gear = [
      ...(['weapon', 'armor', 'accessory'] as Slot[]).flatMap((s) => [1, 2, 3, 4].map((i) => piece(`${s} ${i}`, 'epic', s))),
      piece('Odd Piece', 'epic', undefined),
    ];
    const cards = [...fighters, ...gear];
    const t = buildTower(cards, keys(cards.slice(2)));
    for (const f of t.floors[4].fighters) {
      const base = f.gear.filter((g) => !g.extra).map((g) => g.slot);
      expect(base).toEqual(['weapon', 'armor', 'accessory']);
    }
    expect(t.floors[4].fighters.reduce((n, f) => n + f.gear.filter((g) => g.extra).length, 0)).toBe(3);
    expect(t.noSlot.map((c) => c.name)).toEqual(['Odd Piece']);
  });

  // Value: protects=the extra piece goes only to a Diamond, and only once its three slots are full, and pieces no one
  // can wear are left over; fails_when=pass(true) runs for Golds or before the slots fill (a fighter wears two weapons
  // while missing armor), or leftovers vanish from the bench; why_new=the gear test above has only Diamonds and gear for
  // every slot; seam=none; no_claim=which slot the extra piece should be
  it('gives the extra piece only to a Diamond with all three slots filled, and leaves the rest over', () => {
    const weapons = [1, 2, 3, 4].map((i) => piece(`Weapon ${i}`, 'epic', 'weapon'));
    const t = buildTower([...fighters, ...weapons], keys([...fighters.slice(2), ...weapons]));
    expect(t.floors[4].fighters.map((f) => f.gear.map((g) => [g.slot, g.extra]))).toEqual([[['weapon', false]], [['weapon', false]], [['weapon', false]]]);
    expect(t.bench.map((c) => c.name)).toEqual(['Weapon 4']);

    const gold = char('Goldie', 'gold', 30);
    const dia = char('Dia', 'diamond', 60);
    const gear = (['weapon', 'armor', 'accessory'] as Slot[]).flatMap((s) => [1, 2, 3].map((i) => piece(`${s} ${i}`, 'epic', s)));
    const cards = [...anchors, gold, dia, ...gear];
    const u = buildTower(cards, keys(cards.slice(2)), { [klashKey(gold)]: 4, [klashKey(dia)]: 4 });
    const on4 = Object.fromEntries(u.floors[3].fighters.map((f) => [f.item.name, f.gear.map((g) => g.extra)]));
    expect(on4).toEqual({ Dia: [false, false, false, true], Goldie: [false, false, false] });
    expect(u.bench).toHaveLength(2);
  });

  // Value: protects=a fighter never wears pieces of both its own Friendship and Brutality sets; fails_when=the clash
  // check is dropped; why_new=new module; seam=none; no_claim=other fighters' sets (allowed)
  it("never mixes a fighter's own Friendship and Brutality pieces", () => {
    const own = { setFor: ['Hero'] };
    const cards = [
      ...fighters.slice(0, 3),
      piece('Hero F Weapon', 'epic', 'weapon', { ...own, set: 'friendship' }),
      piece('Hero B Armor', 'epic', 'armor', { ...own, set: 'brutality' }),
      piece('Plain Armor', 'rare', 'armor'),
    ];
    const t = buildTower(cards, keys(cards.slice(2)));
    const hero = t.floors[4].fighters.find((f) => f.item.name === 'Hero')!;
    expect(hero.gear.map((g) => g.item.name).sort()).toEqual(['Hero F Weapon', 'Plain Armor']);
  });

  // Value: protects=Epic gear stays off floors 1 and 2, and the floors above leave Rare for them; fails_when=Epic
  // lands on floor 1, or floor 5 takes the only Rare weapon floor 1 needs; why_new=new module; seam=none; no_claim=none
  it('keeps Epic off floors 1 and 2 and leaves them enough Rare', () => {
    const cards = [
      ...anchors,
      char('D1', 'diamond', 90),
      char('G1', 'gold', 30),
      piece('Epic Weapon', 'epic', 'weapon'),
      piece('Rare Weapon', 'rare', 'weapon'),
    ];
    const t = buildTower(cards, keys(cards.slice(2)));
    const gearOf = (floor: number) => t.floors[floor - 1].fighters.flatMap((f) => f.gear.map((g) => g.item.name));
    expect(gearOf(5)).toEqual(['Epic Weapon']);
    expect(gearOf(1)).toEqual(['Rare Weapon']);
  });

  // Value: protects=a piece of the wearer's own set goes to it; fails_when=the own-set bonus is lost and a random
  // fighter takes it; why_new=new module; seam=none; no_claim=none beyond protects
  it("gives a set piece to its own fighter", () => {
    const cards = [...fighters, piece('Side Two Blade', 'epic', 'weapon', { set: 'friendship', setFor: ['Side Two'] })];
    const t = buildTower(cards, keys(cards.slice(2)));
    const owner = t.floors[4].fighters.find((f) => f.gear.length)!;
    expect(owner.item.name).toBe('Side Two');
  });
});

describe('Klash Tower: pins and the pool', () => {
  // Value: protects=a pinned card stays on its floor, a pin to a floor its rarity can't go on is ignored, and only
  // legal floors are offered; fails_when=pins are ignored, an illegal pin places a card, or pinFloors offers a wrong
  // floor; why_new=new module; seam=none; no_claim=the pin controls on screen
  it('keeps pinned cards on their floor and ignores illegal pins', () => {
    const cards = [...anchors, ...golds(4), ...diamonds(4), ...kameos()];
    const weakD = cards.find((c) => c.name === 'Diamond D')!;
    const gold = cards.find((c) => c.name === 'Gold A')!;
    const t = buildTower(cards, keys(cards.slice(2)), { [klashKey(weakD)]: 5, [klashKey(gold)]: 5 });
    expect(names(t.floors[4].fighters)).toContain('Diamond D');
    expect(t.floors[4].fighters.find((f) => f.item.name === 'Diamond D')!.pinned).toBe(true);
    expect(names(t.floors[4].fighters)).not.toContain('Gold A');
    expect(pinFloors(gold)).toEqual([1, 2, 3, 4]);
    expect(pinFloors(weakD)).toEqual([2, 3, 4, 5]);
    expect(pinFloors(kameos()[0])).toEqual([1, 2, 3]);
  });

  // Value: protects=a floor keeps at most 3 pinned characters (the first by name) and drops a Kameo pin beside a pinned
  // fighter of its exact version, and a pinned Kameo keeps the fighter of its exact version off its floor;
  // fails_when=the slice(0, 3) or the exact-version checks on pins are dropped, so a floor holds 4 fighters or an
  // illegal Kameo pair; why_new=the existing pin test pins one card per floor and never pins a Kameo; seam=none;
  // no_claim=the pin picker on screen (TowerView.test.tsx)
  it('keeps only 3 character pins per floor, and never pins a Kameo beside its exact version', () => {
    const cards = [...anchors, ...diamonds(5)];
    const pinned = (n: string[]) => Object.fromEntries(n.map((x) => [klashKey(cards.find((c) => c.name === x)!), 5]));
    const t = buildTower(cards, keys(cards.slice(2)), pinned(['Diamond B', 'Diamond C', 'Diamond D', 'Diamond E']));
    expect(t.floors[4].fighters.map((f) => [f.item.name, f.pinned])).toEqual([
      ['Diamond B', true],
      ['Diamond C', true],
      ['Diamond D', true],
    ]);
    expect(t.floors.flatMap((f) => f.fighters).find((f) => f.item.name === 'Diamond E')!.pinned).toBe(false);

    const lizard = char('Baraka Lizard', 'diamond', 99);
    const kitana = char('Kitana Klassic', 'diamond', 98);
    const ks = [kameo('Baraka - Lizard', 'diamond'), kameo('Kitana Klassic', 'diamond'), kameo('Plain Kameo', 'diamond')];
    const more = [...anchors, lizard, kitana, ...diamonds(4, 50), ...ks];
    const pins = { [klashKey(lizard)]: 5, [klashKey(ks[0])]: 5, [klashKey(ks[1])]: 5 };
    const u = buildTower(more, keys(more.slice(2)), pins);
    // Baraka Lizard's pin wins, so its Kameo can't be pinned beside it; Kitana's Kameo is pinned there instead, which
    // keeps the strong Kitana Klassic character off floor 5.
    expect(u.floors[4].kameo).toMatchObject({ item: { name: 'Kitana Klassic' }, pinned: true });
    expect(names(u.floors[4].fighters)).toContain('Baraka Lizard');
    expect(names(u.floors[4].fighters)).not.toContain('Kitana Klassic');
    const lizardKameo = u.floors.find((f) => f.kameo?.item.name === 'Baraka - Lizard');
    expect(lizardKameo?.kameo?.pinned).toBe(false);
    expect(names(lizardKameo!.fighters)).not.toContain('Baraka Lizard');
  });

  // Value: protects=a ticked card the catalog no longer has is reported, not silently dropped; fails_when=it vanishes;
  // why_new=pool keys outlive catalog renames; seam=none; no_claim=none beyond protects
  it('reports pool cards the catalog no longer has', () => {
    const t = buildTower(anchors, ['character:gone fighter']);
    expect(t.missing).toEqual(['character:gone fighter']);
  });
});
