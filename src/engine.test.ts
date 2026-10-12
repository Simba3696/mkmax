import { describe, expect, it } from 'vitest';
import { ASCENSION_KARD_COSTS, DIAMOND_KARD_COSTS, GEAR_KARD_COSTS, defaultState } from './defaults';
import {
  addPool, ascensionCaps, buildCtx, buildPlan, cardWeight, copiesAtFusion, editedPack, editorSeasonEnd, fuseWithKards, kardCost, kardStep, kasketPool, kasketPullCards, copiesToMax, copiesToThreshold, copyPhase, daysToAfford, endingSoon, gearForecast, fLevel as F, isMaxed, isRealmKlashGear, levelLabel, moveSeasonEnd, packDrops, packEndOnSave, packEV, packStatus, poolShare, pruneDone, rankPacks, rankTargets, recordPurchase, removeRarity, savePack, seasonEnd, seasonMoveOnSave, suggestSeason, targetLevel,
} from './engine';
import { kardTable, normalize } from './normalize';
import { daysFromNow, kardFooter, kardNotes, kasketLine } from './ui';
import type { AppState, Card, Pack, RarityRule } from './types';
import type { KardPlan } from './engine';

const NOW = new Date('2026-01-10T12:00:00');
/** Stored level for ascension An on a rarity whose fusion tops out at F10. */
const A = (n: number) => F(10) + n;

function setup(cards: Card[], packs: Pack[] = [], tweak?: (s: AppState) => void) {
  const s = defaultState();
  s.cards = cards;
  s.packs = packs;
  tweak?.(s);
  return s;
}

const card = (id: string, fusion: number, extra: Partial<Card> = {}): Card => ({ id, name: id, rarityId: 'diamond', fusion, guest: false, ...extra });
const pack = (id: string, drops: Pack['drops'], extra: Partial<Pack> = {}): Pack => ({
  id, name: id, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops, ...extra,
});
const rules = () => new Map(defaultState().rarities.map((r) => [r.id, r]));

describe('fusion math', () => {
  it('starts at F0 with 1 dupe per level', () => {
    const rule = rules().get('diamond')!;
    expect(levelLabel(rule, 0)).toBe('Not owned');
    expect(levelLabel(rule, 1)).toBe('F0');
    expect(copiesAtFusion(rule, F(0))).toBe(1);
    expect(copiesAtFusion(rule, F(10))).toBe(11);
    expect(copiesToMax(card('a', 0), rule)).toBe(11);
    expect(copiesToThreshold(card('a', F(1)), rule)).toBe(2);
    expect(copiesToThreshold(card('a', F(4)), rule)).toBe(0);
  });
});

describe('goals and caps', () => {
  it('offers F10, A5 and A10 as Gold caps, and nothing for Diamond', () => {
    expect(ascensionCaps(rules().get('gold')!)).toEqual([F(10), A(5), A(10)]);
    expect(ascensionCaps(rules().get('diamond')!)).toEqual([F(10)]);
  });

  it('caps gold at the per-card ascension level', () => {
    const gold = rules().get('gold')!;
    const a5 = card('g', A(1), { rarityId: 'gold', maxLevel: A(5) });
    expect(levelLabel(gold, A(1))).toBe('A1');
    expect(levelLabel(gold, F(10))).toBe('F10');
    expect(targetLevel(a5, gold)).toBe(A(5));
    expect(copiesToMax(a5, gold)).toBe(4);
    expect(copiesToMax(card('g', A(6), { rarityId: 'gold' }), gold)).toBe(4); // A6 → A10
  });

  it('tracks threshold-goal equipment only until F3 (4 copies from nothing)', () => {
    const epic = rules().get('epic')!;
    expect(copiesToMax(card('e', 0, { rarityId: 'epic' }), epic)).toBe(4);
    expect(copiesToMax(card('e', F(2), { rarityId: 'epic' }), epic)).toBe(1);
    expect(isMaxed(card('e', F(3), { rarityId: 'epic' }), epic)).toBe(true);
  });

  it('lets a card override its rarity goal (Realm Klash epics go to max)', () => {
    const epic = rules().get('epic')!;
    const rk = card('rk', F(7), { rarityId: 'epic', goal: 'max' });
    expect(targetLevel(rk, epic)).toBe(F(10));
    expect(copiesToMax(rk, epic)).toBe(3);
    expect(isMaxed(rk, epic)).toBe(false);
  });
});

describe('kameos', () => {
  const kameo = (name: string, fusion = 0) => card(name, fusion, { rarityId: 'kameo-gold' });

  it('only need one copy, and leave the app once owned', () => {
    const rule = rules().get('kameo-gold')!;
    expect(levelLabel(rule, 1)).toBe('F0');
    expect(copiesToMax(kameo('k'), rule)).toBe(1);
    const s = setup([kameo('have', 1), kameo('want')]);
    expect(pruneDone(s)).toEqual(['have']);
    expect(s.cards.map((c) => c.id)).toEqual(['want']);
  });

  it('get Blood Rubies only after the Realm Klash gear', () => {
    const s = setup(
      [card('gear', F(8), { rarityId: 'epic', goal: 'max' }), kameo('k')],
      [
        pack('gear-item', [{ cardId: 'gear', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
        pack('kameo-item', [{ cardId: 'k', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
      ],
      (s) => (s.currencies.find((c) => c.id === 'blood-rubies')!.balance = 1600),
    );
    const rubies = buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    expect(rubies.buys.map((b) => [b.pack.id, b.count])).toEqual([['gear-item', 2]]);
    // With more rubies than the gear needs, the rest goes to the Kameo.
    s.currencies.find((c) => c.id === 'blood-rubies')!.balance = 3200;
    const more = buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    expect(Object.fromEntries(more.buys.map((b) => [b.pack.id, b.count]))).toEqual({ 'gear-item': 2, 'kameo-item': 1 });
  });

  describe('Blood Ruby gear order', () => {
    const gear = (name: string, fusion: number) => card(name, fusion, { rarityId: 'epic', goal: 'max' });
    const item = (cardId: string, extra: Partial<Pack> = {}) =>
      pack(`${cardId} item`, [{ cardId, chance: 100 }], { currencyId: 'blood-rubies', cost: 500, store: true, ...extra });
    const rubies = (s: AppState) => buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    const cards = () => [gear('Bloody Tomahawk', F(8)), gear('Shadow Sash', F(8)), gear("Moloch's Ball and Chain", F(9)), kameo('k')];
    const packs = () => [item('Bloody Tomahawk'), item('Shadow Sash'), item("Moloch's Ball and Chain"), pack('kameo pack', [{ cardId: 'k', chance: 50 }], { currencyId: 'blood-rubies', cost: 100 })];
    const withRubies = (n: number) => (s: AppState) => void (s.currencies.find((c) => c.id === 'blood-rubies')!.balance = n);

    it('maxes one piece at a time, Shadow Sash first by default', () => {
      const plan = rubies(setup(cards(), packs(), withRubies(1500)));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 2], ["Moloch's Ball and Chain item", 1]]);
      expect(plan.saveFor).toMatchObject({ pack: { id: 'Bloody Tomahawk item' }, shortBy: 500, gear: true });
    });

    it('buys no packs until every piece is maxed', () => {
      expect(rubies(setup(cards(), packs(), withRubies(2400))).buys.map((b) => b.pack.id)).toEqual([
        'Shadow Sash item', "Moloch's Ball and Chain item", 'Bloody Tomahawk item',
      ]); // 100 short of the Tomahawk's last copy, so the Kameo pack waits
      expect(rubies(setup(cards(), packs(), withRubies(2600))).buys.map((b) => b.pack.id)).toContain('kameo pack');
    });

    it('follows the saved order', () => {
      const plan = rubies(setup(cards(), packs(), (s) => {
        withRubies(1000)(s);
        s.gearOrder = ['Bloody Tomahawk'];
      }));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Bloody Tomahawk item', 2]]);
      expect(plan.saveFor?.pack.id).toBe('Shadow Sash item');
    });

    it('never spends Epic Fusion Up Kards on the gear', () => {
      const s = setup(cards(), packs(), (s) => {
        withRubies(1500)(s);
        s.rarities.find((r) => r.id === 'epic')!.fusionUpKards = 50;
      });
      const ctx = buildCtx(s);
      expect(ctx.kardPlan.get('epic')?.assignments).toEqual([]);
      expect(rubies(s).buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 2], ["Moloch's Ball and Chain item", 1]]);
    });

    it('moves on when a piece is out of purchases', () => {
      const ps = packs();
      ps[1].maxPurchases = 1;
      const plan = rubies(setup(cards(), ps, withRubies(1000)));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 1], ["Moloch's Ball and Chain item", 1]]);
    });
  });
});

describe('save migration', () => {
  it('shifts version-1 levels (first copy = F1) to F0-based storage', () => {
    const v1 = { version: 1, rarities: [], currencies: [], packs: [], cards: [card('a', 2, { maxLevel: 15 }), card('b', 0)] };
    const s = normalize(v1);
    expect(s.version).toBe(defaultState().version);
    expect(s.cards.map((c) => [c.fusion, c.maxLevel])).toEqual([[3, 16], [0, undefined]]);
    expect(s.rarities.map((r) => r.id)).toEqual(defaultState().rarities.map((r) => r.id));
  });

  it('gives a file with no rarities the built-in ones, not just the ones later upgrades add', () => {
    const s = normalize({ cards: [card('a', F(2)), card('g', F(2), { rarityId: 'gold' })], packs: [] });
    expect(s.rarities.map((r) => r.id)).toEqual(defaultState().rarities.map((r) => r.id));
    expect(normalize({ ...defaultState(), rarities: [] }).rarities).toEqual(defaultState().rarities);
  });

  it('adds the Kameo rarity to older saves once', () => {
    const noKameos = defaultState().rarities.filter((r) => r.kind !== 'kameo');
    const v2 = { ...defaultState(), version: 2, rarities: noKameos };
    expect(normalize(v2).rarities.map((r) => r.id)).toEqual(expect.arrayContaining(['kameo-diamond', 'kameo-gold']));
    // A version-3 save without a Kameo rarity means the user deleted it; don't bring it back.
    expect(normalize({ ...v2, version: 3 }).rarities.some((r) => r.kind === 'kameo')).toBe(false);
  });

  it('splits the single version-3 Kameo rarity into Diamond and Gold, keeping its cards as Diamond', () => {
    const single = { id: 'kameo', label: 'Kameo', kind: 'kameo' as const, color: '#ff7ab8', dupesPerLevel: [], fusionMax: 0, goal: 'max' as const, hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [] };
    const v3 = { ...defaultState(), version: 3, rarities: [...defaultState().rarities.filter((r) => r.kind !== 'kameo'), single], cards: [card('baraka', 0, { rarityId: 'kameo' })] };
    const s = normalize(v3);
    expect(s.rarities.map((r) => r.id)).not.toContain('kameo');
    expect(s.rarities.map((r) => r.id)).toEqual(expect.arrayContaining(['kameo-diamond', 'kameo-gold']));
    expect(s.cards.map((c) => c.rarityId)).toEqual(['kameo-diamond']);
  });

  it('takes the extra fusion step an outdated app added back off the Kameo rarities', () => {
    const s = normalize({
      ...defaultState(),
      rarities: defaultState().rarities.map((r) => (r.kind === 'kameo' ? { ...r, dupesPerLevel: [1] } : r)),
      cards: [card('k', 1, { rarityId: 'kameo-gold' }), card('want', 0, { rarityId: 'kameo-gold' })],
    });
    expect(s.rarities.filter((r) => r.kind === 'kameo').map((r) => r.dupesPerLevel)).toEqual([[], []]);
    expect(s.cards.map((c) => c.id)).toEqual(['want']); // owning one is done again
  });

  it('moves Blood Ruby gear to Epic with a max goal, and drops priority tiers', () => {
    const old = {
      ...defaultState(),
      rarities: [...defaultState().rarities, { ...defaultState().rarities[2], id: 'blood-ruby', label: 'Blood Ruby Equip', goal: 'max' }],
      weights: { ...defaultState().weights, tier: { must: 3, want: 2, nice: 1, skip: 0 } },
      cards: [{ ...card('sash', F(7), { rarityId: 'blood-ruby' }), tier: 'want' }],
    };
    const s = normalize(old);
    expect(s.rarities.map((r) => r.id)).not.toContain('blood-ruby');
    expect(s.cards).toEqual([expect.objectContaining({ id: 'sash', rarityId: 'epic', goal: 'max', fusion: F(7) })]);
    expect(s.cards[0]).not.toHaveProperty('tier');
    expect(s.weights).not.toHaveProperty('tier');
  });

  it('turns Kaskets entered by hand into Kaskets, once, leaving other packs', () => {
    const drops = [{ cardId: 'a', chance: 2.5 }];
    const v14 = {
      ...defaultState(),
      version: 14,
      cards: [card('a', 0)],
      packs: [
        pack('kd', drops, { name: 'Kollector’s Diamond Kasket', rolls: 2 }),
        pack('ke', drops, { name: 'Event Epic Equipment Kasket', store: true }),
        pack('kp', drops, { name: 'Kombat Pack' }),
        // Typed by hand: a straight apostrophe and other capitals still match; without the apostrophe it's another name.
        pack('kg', drops, { name: "Kollector's gold kasket" }),
        pack('kr', drops, { name: 'EVENT RARE EQUIPMENT KASKET' }),
        pack('kn', drops, { name: 'Kollectors Diamond Kasket' }),
      ],
    };
    const s = normalize(v14);
    expect(s.packs.map((p) => [p.id, p.kasket, p.drops.length, p.rolls])).toEqual([
      ['kd', 'diamond', 0, 1], ['ke', undefined, 1, 1], ['kp', undefined, 1, 1], ['kg', 'gold', 0, 1], ['kr', 'rare', 0, 1], ['kn', undefined, 1, 1],
    ]);
    // A version 15 save is left alone, so a pack unticked as a Kasket stays unticked.
    expect(normalize({ ...v14, version: 15 }).packs.every((p) => p.kasket === undefined)).toBe(true);
  });

  it('keeps an imported Kasket at one card per purchase with no drops, and treats a null or empty rarity as no Kasket', () => {
    const drops = [{ cardId: 'a', chance: 50 }];
    const s = normalize({
      ...defaultState(),
      cards: [card('a', 0)],
      packs: [pack('k', drops, { kasket: 'diamond', rolls: 5, store: true }), { ...pack('n', drops), kasket: null }, pack('e', drops, { kasket: '' })],
    });
    expect(s.packs[0]).toEqual(pack('k', [], { kasket: 'diamond' }));
    expect(s.packs[0]).not.toHaveProperty('store');
    expect(s.packs[1]).not.toHaveProperty('kasket');
    expect(s.packs[2]).not.toHaveProperty('kasket');
    expect(s.packs[1].drops).toEqual(drops);
  });
});

describe('phases', () => {
  it('classifies unlock, threshold, normal, kard-covered and maxed copies', () => {
    const s = setup([card('new', 0), card('low', F(1)), card('mid', F(5)), card('max', F(10))], [], (s) => (s.rarities[0].fusionUpKards = 7));
    const ctx = buildCtx(s);
    const c = (id: string) => ctx.cards.get(id)!;
    expect(copyPhase(ctx, c('new'))).toBe('unlock');
    expect(copyPhase(ctx, c('low'))).toBe('toThreshold');
    expect(copyPhase(ctx, c('mid'))).toBe('normal'); // 5 to max; 7 kards buy F5→F6 (3) + F6→F7 (4), covering 2
    expect(copyPhase(ctx, c('mid'), 3)).toBe('kardCovered');
    expect(copyPhase(ctx, c('max'))).toBe('maxed');
  });

  it('charges the Diamond kard curve per step', () => {
    const diamond = rules().get('diamond')!;
    expect([3, 4, 5, 6, 7, 8, 9].map((f) => kardCost(diamond, F(f)))).toEqual([1, 2, 3, 4, 5, 7, 10]);
    expect(kardCost(diamond, F(2))).toBeNull(); // below the F3 threshold
    expect(kardCost(diamond, F(10))).toBeNull(); // already F10
    // 10 kards: exactly F9 → F10 when that's the only card.
    const s = setup([card('near', F(9))], [], (s) => (s.rarities[0].fusionUpKards = 10));
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [{ cardId: 'near', from: F(9), to: F(10), kards: 10 }], left: 0, cards: 1, cheapest: 10, realmKlash: 0 });
  });

  it('uses Fusion Up Kards for one step: kards off the Wallet, the card up a level', () => {
    const s = setup([card('d', F(3)), card('low', F(2)), card('gear', F(5), { rarityId: 'epic', goal: 'max' })], [], (s) => (s.rarities[0].fusionUpKards = 3));
    expect(kardStep(s, 'd')).toBe(1); // F3 → F4
    expect(fuseWithKards(s, 'd')).toBe(1);
    expect(s.cards[0].fusion).toBe(F(4));
    expect(s.rarities[0].fusionUpKards).toBe(2);
    expect(kardStep(s, 'd')).toBe(2); // F4 → F5 takes the last 2
    fuseWithKards(s, 'd');
    expect(kardStep(s, 'd')).toBeNull(); // F5 → F6 costs 3, the Wallet is empty
    expect(fuseWithKards(s, 'd')).toBeNull();
    expect(s.cards[0].fusion).toBe(F(5));
    expect(kardStep(s, 'low')).toBeNull(); // below F3
    expect(kardStep(s, 'gear')).toBeNull(); // Realm Klash gear never takes kards
  });

  it("uses kards on a Gold ascension step, and not past the card's cap", () => {
    const s = setup([card('g', F(10), { rarityId: 'gold', maxLevel: A(1) })], [], (s) => (s.rarities[1].fusionUpKards = 30));
    expect(fuseWithKards(s, 'g')).toBe(10);
    expect(s.cards[0].fusion).toBe(A(1));
    expect(kardStep(s, 'g')).toBeNull(); // at its A1 cap
    expect(s.rarities[1].fusionUpKards).toBe(20);
  });

  it("spends Gold kards on ascension too, up to the card's own cap", () => {
    const gold = rules().get('gold')!;
    expect(kardCost(gold, F(10))).toBe(10); // F10 → A1
    expect(kardCost(gold, A(1))).toBe(11); // A1 → A2
    expect(kardCost(gold, A(9))).toBe(30); // A9 → A10
    expect(kardCost(gold, A(10))).toBeNull(); // already A10
    // 25 kards on a card capped at A2: F9→F10 (10), F10→A1 (10); A1→A2 (11) doesn't fit. 5 left over.
    const s = setup([card('g', F(9), { rarityId: 'gold', maxLevel: A(2) })], [], (s) => (s.rarities[1].fusionUpKards = 25));
    expect(buildCtx(s).kardPlan.get('gold')).toEqual({ assignments: [{ cardId: 'g', from: F(9), to: A(1), kards: 20 }], left: 5, cards: 1, cheapest: 10, realmKlash: 0 });
  });

  it('adds Uncommon gear to older saves once, after Rare', () => {
    const v5 = { ...defaultState(), version: 5, rarities: defaultState().rarities.filter((r) => r.id !== 'uncommon') };
    const out = normalize(v5);
    expect(out.rarities.map((r) => r.id).slice(2, 5)).toEqual(['epic', 'rare', 'uncommon']);
    expect(out.rarities.find((r) => r.id === 'uncommon')).toMatchObject({ goal: 'max', fusionUpThreshold: null, kardsPerLevel: [] });
    const deleted = { ...out, rarities: out.rarities.filter((r) => r.id !== 'uncommon') };
    expect(normalize(deleted).rarities.some((r) => r.id === 'uncommon')).toBe(false);
  });

  it('costs an added level the same in Settings as after a reload', () => {
    const gold = structuredClone(rules().get('gold')!);
    gold.dupesPerLevel.push(1); // + Level
    const costs = kardTable(gold);
    expect(costs).toHaveLength(21);
    expect(costs.at(-1)).toBe(10);
    expect(kardTable({ ...gold, kardsPerLevel: costs })).toEqual(costs);
    expect(normalize({ ...defaultState(), rarities: [{ ...gold, kardsPerLevel: costs }] }).rarities[0].kardsPerLevel).toEqual(costs);
  });

  it('starts kard costs at 0 when kards are turned on for a built-in rarity that has none, like Uncommon gear', () => {
    const uncommon = { ...defaultState().rarities.find((r) => r.id === 'uncommon')!, fusionUpThreshold: 3 };
    expect(kardTable(uncommon)).toEqual(Array(10).fill(0));
    // A custom rarity with no table still gets the Diamond curve.
    expect(kardTable({ ...uncommon, id: 'custom' }).slice(3, 10)).toEqual(DIAMOND_KARD_COSTS.slice(3, 10));
  });

  it("fixes pack names saved as \"Kollector’S\" once", () => {
    const pack = { id: 'k', name: 'Kollector’S Diamond Kasket', currencyId: 'souls', cost: 0, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [] };
    expect(normalize({ ...defaultState(), version: 9, packs: [pack] }).packs[0].name).toBe('Kollector’s Diamond Kasket');
  });

  it('drops an unused Time Krystals currency once, keeping one that is in use', () => {
    const tk = { id: 'time-krystals', name: 'Time Krystals', balance: 0 };
    const old = { ...defaultState(), version: 10, currencies: [...defaultState().currencies, tk] };
    expect(normalize(old).currencies.map((c) => c.id)).not.toContain('time-krystals');
    const kept = { ...old, currencies: [...defaultState().currencies, { ...tk, balance: 40 }] };
    expect(normalize(kept).currencies.map((c) => c.id)).toContain('time-krystals');
    const added = { ...defaultState(), currencies: [...defaultState().currencies, tk] };
    expect(normalize(added).currencies.map((c) => c.id)).toContain('time-krystals');
  });

  it('gives Gold ascension the game\'s kard costs once, keeping edited tables', () => {
    const old = structuredClone({ ...defaultState(), version: 12 });
    const gold = () => old.rarities.find((r) => r.id === 'gold')!;
    gold().kardsPerLevel = [...DIAMOND_KARD_COSTS, ...Array(10).fill(10)];
    expect(normalize(old).rarities.find((r) => r.id === 'gold')?.kardsPerLevel.slice(10)).toEqual(ASCENSION_KARD_COSTS);
    // An edited table is left alone.
    gold().kardsPerLevel[12] = 9;
    expect(normalize(old).rarities.find((r) => r.id === 'gold')?.kardsPerLevel.slice(10, 13)).toEqual([10, 10, 9]);
    // A save already on version 13 isn't changed again, even with flat costs.
    const flat = structuredClone(defaultState());
    flat.rarities.find((r) => r.id === 'gold')!.kardsPerLevel = [...DIAMOND_KARD_COSTS, ...Array(10).fill(10)];
    expect(normalize(flat).rarities.find((r) => r.id === 'gold')?.kardsPerLevel.slice(10)).toEqual(Array(10).fill(10));
  });

  it('switches a rarity with no kards from the kard threshold to max once, so picking a kard level keeps its cards', () => {
    const old = structuredClone({ ...defaultState(), version: 13 });
    const epic = old.rarities.find((r) => r.id === 'epic')!;
    epic.fusionUpThreshold = null;
    old.cards = [{ id: 'e1', name: 'Epic Relic', rarityId: 'epic', fusion: F(5), guest: false }];
    const out = normalize(old);
    expect(out.rarities.find((r) => r.id === 'epic')?.goal).toBe('max');
    expect(out.rarities.find((r) => r.id === 'rare')?.goal).toBe('threshold');
    // With kards back on, the card is still tracked to max rather than capped at F3 and removed.
    out.rarities.find((r) => r.id === 'epic')!.fusionUpThreshold = 3;
    expect(targetLevel(out.cards[0], out.rarities.find((r) => r.id === 'epic')!)).toBe(F(10));
    // A save already on version 14 isn't changed again.
    const current = structuredClone(defaultState());
    current.rarities.find((r) => r.id === 'epic')!.fusionUpThreshold = null;
    expect(normalize(current).rarities.find((r) => r.id === 'epic')?.goal).toBe('threshold');
  });

  it('gives Epic and Rare gear their kard costs and Kameos guests once, keeping edited tables', () => {
    const old = structuredClone({ ...defaultState(), version: 11 });
    for (const r of old.rarities) {
      if (r.id === 'epic' || r.id === 'rare') r.kardsPerLevel = [...DIAMOND_KARD_COSTS];
      if (r.kind === 'kameo') r.hasGuests = false;
    }
    old.rarities.find((r) => r.id === 'rare')!.kardsPerLevel[3] = 2;
    const out = normalize(old).rarities;
    expect(out.find((r) => r.id === 'epic')?.kardsPerLevel).toEqual(GEAR_KARD_COSTS);
    expect(out.find((r) => r.id === 'rare')?.kardsPerLevel[3]).toBe(2);
    expect(out.filter((r) => r.kind === 'kameo').every((r) => r.hasGuests)).toBe(true);
    const cleared = { ...defaultState(), rarities: defaultState().rarities.map((r) => ({ ...r, hasGuests: false })) };
    expect(normalize(cleared).rarities.find((r) => r.id === 'kameo-gold')?.hasGuests).toBe(false);
  });

  it('gives Blood Rubies a daily income once, keeping one that was cleared', () => {
    const old = { ...defaultState(), version: 9, currencies: defaultState().currencies.map(({ perDay: _, ...c }) => c) };
    expect(normalize(old).currencies.find((c) => c.id === 'blood-rubies')?.perDay).toBe(65);
    const cleared = { ...normalize(old), currencies: old.currencies };
    expect(normalize(cleared).currencies.find((c) => c.id === 'blood-rubies')?.perDay).toBeUndefined();
  });

  it('extends older Gold kard tables through ascension, keeping edited fusion costs', () => {
    const s = defaultState();
    const gold = s.rarities.find((r) => r.id === 'gold')!;
    gold.kardsPerLevel = [0, 0, 0, 2, 2, 3, 4, 5, 7, 10];
    const out = normalize(s).rarities.find((r) => r.id === 'gold')!;
    expect(out.kardsPerLevel.slice(0, 4)).toEqual([0, 0, 0, 2]);
    expect(out.kardsPerLevel).toHaveLength(20);
  });

  it('spends kards on the cheapest steps first, weighting guest cards', () => {
    // Costs: F4→F5 2, F5→F6 3, F6→F7 4, F8→F9 7. Guest steps count 1.5×, so guest F4→F6 (5 kards), then
    // the plain F4→F5 (2) beats the guest's F6→F7 (4); the near-max card's 7-kard step never wins. 1 left over.
    const s = setup([card('far', F(4)), card('near', F(8)), card('guest', F(4), { guest: true })], [], (s) => (s.rarities[0].fusionUpKards = 8));
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({
      assignments: [
        { cardId: 'guest', from: F(4), to: F(6), kards: 5 },
        { cardId: 'far', from: F(4), to: F(5), kards: 2 },
      ],
      left: 1,
      cards: 3,
      cheapest: 2,
      realmKlash: 0,
    });
  });

  it('breaks a kard tie toward the card with the fewest steps left to its goal', () => {
    // F9→F10 and F10→A1 both cost 10 Gold kards. x is one step from its F10 cap; y is ten steps from A10.
    const s = setup([card('y', F(10), { rarityId: 'gold' }), card('x', F(9), { rarityId: 'gold', maxLevel: F(10) })], [], (s) => (s.rarities[1].fusionUpKards = 10));
    expect(buildCtx(s).kardPlan.get('gold')).toEqual({ assignments: [{ cardId: 'x', from: F(9), to: F(10), kards: 10 }], left: 0, cards: 2, cheapest: 10, realmKlash: 0 });
  });

  it('counts the cards kards could go to, so the plan can tell no card at F3 from too few kards', () => {
    const s = setup([card('low', F(2)), card('rk', F(5), { rarityId: 'epic', name: 'Shadow Sash' })], [], (s) => {
      s.rarities[0].fusionUpKards = 30;
      s.rarities.find((r) => r.id === 'epic')!.fusionUpKards = 30;
    });
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [], left: 30, cards: 0, cheapest: null, realmKlash: 0 });
    expect(buildCtx(s).kardPlan.get('epic')).toEqual({ assignments: [], left: 30, cards: 0, cheapest: null, realmKlash: 1 }); // Realm Klash gear gets none
    // A card at F9 with 5 kards: there's a card, just not enough kards for its 10-kard step, which the plan names.
    s.cards = [card('near', F(9))];
    s.rarities[0].fusionUpKards = 5;
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [], left: 5, cards: 1, cheapest: 10, realmKlash: 0 });
  });

  describe('gear tracked to max', () => {
    // Gear kards: F3→F4 1, then 3, 5, 7, 9, 12, F9→F10 15. Finishing costs 27 from F8, 36 from F7, 52 from F3.
    const gear = (id: string, fusion: number, extra: Partial<Card> = {}) => card(id, fusion, { rarityId: 'epic', ...extra });
    const epicPlan = (cards: Card[], kards: number, tweak?: (epic: RarityRule) => void) => {
      const s = setup(cards, [], (s) => {
        const epic = s.rarities.find((r) => r.id === 'epic')!;
        epic.goal = 'max';
        epic.fusionUpKards = kards;
        tweak?.(epic);
      });
      const ctx = buildCtx(s);
      return { ctx, plan: ctx.kardPlan.get('epic') };
    };

    it('finishes the piece needing fewest kards and keeps the rest for the next one', () => {
      const { plan } = epicPlan([gear('f8', F(8)), gear('f7', F(7)), gear('f3', F(3))], 60);
      expect(plan).toEqual({ assignments: [{ cardId: 'f8', from: F(8), to: F(10), kards: 27 }], left: 33, cards: 3, cheapest: 1, realmKlash: 0, next: { cardId: 'f7', needs: 36 } });
    });

    it('lists finished pieces in the order to fuse them, fewest kards first', () => {
      const { plan } = epicPlan([gear('f7', F(7)), gear('f9', F(9)), gear('f8', F(8))], 100);
      expect(plan?.assignments.map((a) => a.cardId)).toEqual(['f9', 'f8', 'f7']);
      expect(plan?.left).toBe(22);
    });

    it('orders pieces by the kards they need, not by name or level', () => {
      // zulu needs 1 kard (F3 → its own cap F4), alpha needs 27 (F8 → F10). Name or level order would pick alpha.
      const { plan } = epicPlan([gear('alpha', F(8)), gear('zulu', F(3), { maxLevel: F(4) })], 27);
      expect(plan?.assignments).toEqual([{ cardId: 'zulu', from: F(3), to: F(4), kards: 1 }]);
      expect(plan).toMatchObject({ left: 26, next: { cardId: 'alpha', needs: 27 } });
    });

    // Value: protects=Realm Klash gear on the list never gets kards, with no Goal or store item marking it; fails_when=the plan
    // spends kards on a listed piece, or still treats a Goal of Max or a Blood Ruby store item as Realm Klash; why_new=Realm
    // Klash gear is now recognised by name only; seam=none; no_claim=the Cards label (browser QA)
    it('never plans kards on Realm Klash gear, even when it needs the fewest, and plans other gear normally', () => {
      // Devastator (listed) needs 15; kmax (unlisted, Goal Max) needs 15; sold (unlisted, a Blood Ruby store item) needs 27.
      const item = pack('sold item', [{ cardId: 'sold', chance: 100 }], { currencyId: 'blood-rubies', store: true });
      const s = setup([gear('rk', F(9), { name: 'Devastator' }), gear('kmax', F(9), { goal: 'max' }), gear('sold', F(8))], [item], (s) => {
        const epic = s.rarities.find((r) => r.id === 'epic')!;
        epic.goal = 'max';
        epic.fusionUpKards = 30;
      });
      expect(buildCtx(s).kardPlan.get('epic')).toEqual({
        assignments: [{ cardId: 'kmax', from: F(9), to: F(10), kards: 15 }],
        left: 15,
        cards: 2,
        cheapest: 12,
        realmKlash: 1,
        next: { cardId: 'sold', needs: 27 },
      });
      expect(kardStep(s, 'rk')).toBeNull();
    });

    // Ids sort the other way from names, so these fail if the tie-break uses ids or save order instead of names.
    const tied = () => [gear('a', F(8), { name: 'Bravo' }), gear('b', F(8), { name: 'Alpha' })];

    it('breaks a tie alphabetically by name', () => {
      const { plan } = epicPlan(tied(), 27);
      expect(plan?.assignments).toEqual([{ cardId: 'b', from: F(8), to: F(10), kards: 27 }]);
      expect(plan).toMatchObject({ left: 0, next: { cardId: 'a', needs: 27 } });
    });

    it('lists tied finished pieces alphabetically, as they are finished', () => {
      const { plan } = epicPlan(tied(), 54);
      expect(plan?.assignments.map((a) => a.cardId)).toEqual(['b', 'a']);
    });

    it('breaks a tie on kards needed by finishing the higher-level piece first', () => {
      // Both need 9: F3→F6 is 1 + 3 + 5, F7→F8 is 9. Alphabetical order alone would pick 'alpha'.
      const { plan } = epicPlan([gear('alpha', F(3), { maxLevel: F(6) }), gear('zulu', F(7), { maxLevel: F(8) })], 9);
      expect(plan?.assignments).toEqual([{ cardId: 'zulu', from: F(7), to: F(8), kards: 9 }]);
      expect(plan?.next).toEqual({ cardId: 'alpha', needs: 9 });
    });

    it("lists pieces kards can't finish because a step on the way has no kard cost", () => {
      const plan = (kards: number) =>
        epicPlan([gear('f8', F(8)), gear('capped', F(8), { maxLevel: F(9) })], kards, (epic) => {
          epic.kardsPerLevel = epic.kardsPerLevel.map((k, f) => (f === 9 ? 0 : k)); // no kard cost for F9→F10
        }).plan;
      expect(plan(100)).toEqual({ assignments: [{ cardId: 'capped', from: F(8), to: F(9), kards: 12 }], left: 88, cards: 2, cheapest: 12, realmKlash: 0, stuck: ['f8'] });
      // Value: protects=a plan carries both next and stuck, which the Plan card shows as two lines; fails_when=one of them is dropped when the other is set; why_new=no test had both at once; seam=none; no_claim=the Plan card's wording (checked by browser QA)
      expect(plan(5)).toEqual({ assignments: [], left: 5, cards: 2, cheapest: 12, realmKlash: 0, next: { cardId: 'capped', needs: 12 }, stuck: ['f8'] });
    });

    it("spends nothing when the kards can't finish any piece", () => {
      const { plan } = epicPlan(['e3', 'e1', 'e5', 'e2', 'e4'].map((id) => gear(id, F(3))), 20);
      expect(plan).toEqual({ assignments: [], left: 20, cards: 5, cheapest: 1, realmKlash: 0, next: { cardId: 'e1', needs: 52 } });
    });

    it("finishes a piece at its own cap when that's below F10", () => {
      const { plan } = epicPlan([gear('capped', F(3), { maxLevel: F(5) })], 4);
      expect(plan).toEqual({ assignments: [{ cardId: 'capped', from: F(3), to: F(5), kards: 4 }], left: 0, cards: 1, cheapest: 1, realmKlash: 0 });
    });

    it('counts only finished pieces as covered by kards', () => {
      const { ctx } = epicPlan([gear('f8', F(8)), gear('f7', F(7))], 60);
      expect(ctx.kardCopies.get('f8')).toBe(2);
      expect(ctx.kardCopies.has('f7')).toBe(false);
      expect(copyPhase(ctx, ctx.cards.get('f8')!)).toBe('kardCovered');
      expect(copyPhase(ctx, ctx.cards.get('f7')!)).toBe('normal');
    });

    // Value: protects=tapping Use step by step on the top gear row keeps that piece first and the kards left unchanged; fails_when=a part-fused piece is costed from F3 or loses its place; why_new=only browser QA covered Use on gear; seam=none; no_claim=the Use button and Undo in the Plan card (browser QA)
    it('keeps the same piece first while it is fused one step at a time with Use', () => {
      const { ctx } = epicPlan([gear('f8', F(8)), gear('f7', F(7))], 60);
      const s = ctx.state;
      expect(fuseWithKards(s, 'f8')).toBe(12); // F8 → F9
      expect(buildCtx(s).kardPlan.get('epic')).toEqual({ assignments: [{ cardId: 'f8', from: F(9), to: F(10), kards: 15 }], left: 33, cards: 2, cheapest: 9, realmKlash: 0, next: { cardId: 'f7', needs: 36 } });
      expect(fuseWithKards(s, 'f8')).toBe(15); // F9 → F10, finished
      expect(buildCtx(s).kardPlan.get('epic')).toEqual({ assignments: [], left: 33, cards: 1, cheapest: 9, realmKlash: 0, next: { cardId: 'f7', needs: 36 } });
    });
  });
});

describe('scoring', () => {
  it('values a copy that reaches F3 more than one past it', () => {
    const s = setup([card('low', F(1)), card('high', F(5))], [pack('a', [{ cardId: 'low', chance: 10 }]), pack('b', [{ cardId: 'high', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeGreaterThan(packEV(ctx, s.packs[1]));
  });

  it('boosts guest cards', () => {
    const s = setup([card('g', F(5), { guest: true }), card('n', F(5))], [pack('a', [{ cardId: 'g', chance: 10 }]), pack('b', [{ cardId: 'n', chance: 10 }])]);
    const ctx = buildCtx(s);
    expect(packEV(ctx, s.packs[0])).toBeCloseTo(packEV(ctx, s.packs[1]) * 1.5);
  });

  it('ignores maxed cards', () => {
    const s = setup([card('m', F(10))], [pack('a', [{ cardId: 'm', chance: 50 }])]);
    expect(packEV(buildCtx(s), s.packs[0])).toBe(0);
  });
});

describe('weights', () => {
  it('counts guests up, Kameos down, and challenge Kameos down again', () => {
    const s = setup([]);
    expect(cardWeight(s, card('plain', 0))).toBe(1);
    expect(cardWeight(s, card('guest', 0, { guest: true }))).toBe(1.5);
    expect(cardWeight(s, card('kameo', 0, { rarityId: 'kameo-gold' }))).toBe(0.25);
    expect(cardWeight(s, card('elder', 0, { rarityId: 'kameo-gold', guest: true, source: 'challenge' }))).toBeCloseTo(1.5 * 0.25 * 0.2);
  });

  // Value: protects=Realm Klash gear is the fixed list of gear, matched by name; fails_when=a listed piece is missed (a typo or
  // apostrophe), unlisted gear counts because of its Goal or a store item, or a character with a listed name counts;
  // why_new=the list replaced Goal and store items; seam=none; no_claim=the game adding pieces (the list is final)
  it('recognises Realm Klash gear by name, whatever its goal or store items', () => {
    const named = (name: string, extra: Partial<Card> = {}) => card('x', F(5), { rarityId: 'epic', name, ...extra });
    const listed = ['Bloody Shokan Armor', 'Bloody Tomahawk', 'Bloody Voodoo Doll', 'Datusha, Bane of the Moroi', 'Devastator', "Blaze's Life Force", "Moloch's Ball and Chain", 'Shadow Sash', "Shang Tsung's Stone", "Sindel's Signet Ring"];
    for (const name of listed) expect(isRealmKlashGear(setup([named(name)]), named(name)), name).toBe(true);
    expect(isRealmKlashGear(setup([]), named('SHANG TSUNG’S STONE'))).toBe(true); // nor case or a curly apostrophe
    expect(isRealmKlashGear(setup([]), named('signet ring, sindel’s'))).toBe(true); // nor word order
    // Unlisted gear isn't Realm Klash gear, even with a Goal of Max or sold for Blood Rubies.
    const kori = named('Kori Blade', { goal: 'max' });
    const item = pack('kori item', [{ cardId: 'x', chance: 100 }], { currencyId: 'blood-rubies', store: true });
    expect(isRealmKlashGear(setup([kori], [item]), kori)).toBe(false);
    // A character with a listed name isn't gear.
    expect(isRealmKlashGear(setup([]), card('x', F(5), { name: 'Devastator' }))).toBe(false);
    // Realm Klash gear is always bought to max, whatever its stored goal.
    expect(targetLevel(named('Devastator', { goal: 'threshold' }), rules().get('epic')!)).toBe(F(10));
  });
});

describe('pack ranking and targets', () => {
  it('tells active, upcoming and expired packs apart', () => {
    expect(packStatus(pack('p', [], { startsAt: '2026-01-11T00:00' }), NOW)).toBe('upcoming');
    expect(packStatus(pack('p', [], { startsAt: '2026-01-11T00:00', endsAt: '2026-01-11T00:00' }), NOW)).toBe('upcoming');
    expect(packStatus(pack('p', [], { startsAt: '2026-01-09T00:00', endsAt: '2026-01-09T00:00' }), NOW)).toBe('expired');
    expect(packStatus(pack('p', [], { endsAt: '2026-01-10T12:00' }), NOW)).toBe('active'); // ends this minute
    expect(packStatus(pack('p', [], { endsAt: '2026-01-10T11:59' }), NOW)).toBe('expired');
  });

  it('ranks packs by value per 1,000 currency, leaving expired ones out', () => {
    const drops = [{ cardId: 'a', chance: 10 }];
    const s = setup([card('a', F(5))], [
      pack('dear', drops, { cost: 200 }),
      pack('cheap', drops),
      pack('gone', [{ cardId: 'a', chance: 50 }], { endsAt: '2026-01-01T00:00' }),
      pack('next', drops, { startsAt: '2026-01-11T00:00' }),
    ]);
    const ranks = rankPacks(buildCtx(s), NOW);
    expect(ranks.map((r) => [r.pack.id, r.status])).toEqual([['cheap', 'active'], ['next', 'upcoming'], ['dear', 'active']]);
    expect(ranks[0].evPerK).toBeCloseTo(ranks[2].evPerK * 2);
  });

  it('leaves Krypt, tower and challenge cards out of the targets unless a current pack drops them', () => {
    const s = setup(
      [card('char', F(5)), card('krypt', F(5), { source: 'krypt' }), card('tower', F(5), { source: 'tower' }), card('sold', F(5), { source: 'krypt' })],
      [pack('p', [{ cardId: 'sold', chance: 10 }]), pack('old', [{ cardId: 'tower', chance: 10 }], { endsAt: '2026-01-01T00:00' })],
    );
    expect(rankTargets(buildCtx(s), NOW).map((t) => [t.card.id, t.inPacks])).toEqual([['char', 0], ['sold', 1]]);
  });
});

describe('kaskets', () => {
  const kasket = (rarity: string, extra: Partial<Pack> = {}) => pack('k', [], { kasket: rarity, ...extra });
  const ids = (cards: Card[]) => cards.map((c) => c.id);

  it("gives an even share of the cards you don't own, leaving out the newest from the latest update", () => {
    const fresh = Array.from({ length: 9 }, (_, i) => card(`d${i}`, 0));
    // The excluded cards spelled the way the user might type them: word order and MKII don't matter.
    const excluded = [card('x1', 0, { name: 'MK1 Sub-Zero' }), card('x2', 0, { name: 'MKII Movie Scorpion' })];
    const s = setup([...fresh, card('guest', 0, { guest: true }), ...excluded, card('owned', F(3))], [kasket('diamond')]);
    const ctx = buildCtx(s);
    const pool = kasketPool(ctx, s.packs[0]);
    expect(pool.mode).toBe('new');
    expect(ids(pool.cards)).toEqual([...ids(fresh), 'guest']);
    expect(packDrops(ctx, s.packs[0]).every((d) => d.chance === 10)).toBe(true);
    // Valued exactly like a pack listing those ten cards at 10% each.
    const listed = pack('listed', pool.cards.map((c) => ({ cardId: c.id, chance: 10 })));
    expect(packEV(ctx, s.packs[0])).toBeCloseTo(packEV(ctx, listed));
    expect(rankPacks(ctx, NOW)[0].targets.map((t) => t.card.id).sort()).toEqual([...ids(fresh), 'guest'].sort());

    // Unlocking one takes it out of the pool straight away.
    s.cards[0].fusion = F(0);
    const after = packDrops(buildCtx(s), s.packs[0]);
    expect(after).toHaveLength(9);
    expect(after[0].chance).toBeCloseTo(100 / 9);
  });

  it('gives cards short of max once you own them all, counting ascending Gold cards up to their cap', () => {
    const s = setup(
      [
        card('ascending', A(2), { rarityId: 'gold', maxLevel: A(5) }),
        card('fusing', F(5), { rarityId: 'gold' }),
        card('capped', A(5), { rarityId: 'gold', maxLevel: A(5) }),
        card('x', F(2), { rarityId: 'gold', name: 'Flame Forged Will' }),
      ],
      [kasket('gold')],
    );
    const pool = kasketPool(buildCtx(s), s.packs[0]);
    expect(pool.mode).toBe('unmaxed');
    expect(ids(pool.cards)).toEqual(['ascending', 'fusing']);
  });

  it("isn't valued once you own every piece of gear tracked only to the kard threshold, unless it's tracked to max", () => {
    const s = setup([card('e1', F(2), { rarityId: 'epic' }), card('e2', F(1), { rarityId: 'epic' })], [kasket('epic')]);
    expect(kasketPool(buildCtx(s), s.packs[0])).toMatchObject({ mode: 'none', cards: [] });
    expect(packEV(buildCtx(s), s.packs[0])).toBe(0);
    s.rarities.find((r) => r.id === 'epic')!.goal = 'max';
    expect(ids(kasketPool(buildCtx(s), s.packs[0]).cards)).toEqual(['e1', 'e2']);
  });

  it("isn't valued when only excluded cards are left, or its rarity is gone", () => {
    const s = setup([card('x1', F(4), { name: 'Sub-Zero MK1' }), card('x2', 0, { name: 'Scorpion MK2 Movie' })], [kasket('diamond'), kasket('gone', { id: 'k2' })]);
    const ctx = buildCtx(s);
    expect(kasketPool(ctx, s.packs[0])).toMatchObject({ mode: 'none', cards: [] });
    expect(kasketPool(ctx, s.packs[1])).toEqual({ mode: 'none', cards: [] });
    expect(packEV(ctx, s.packs[0]) + packEV(ctx, s.packs[1])).toBe(0);
  });

  it('switches the planner to unmaxed cards after as many buys as there are new ones', () => {
    const fresh = Array.from({ length: 10 }, (_, i) => card(`d${i}`, 0));
    const s = setup([...fresh, card('owned', F(3))], [kasket('diamond')], (s) => (s.currencies[0].balance = 1100));
    const plan = buildPlan(buildCtx(s), NOW);
    expect(plan.currencies[0].buys.map((b) => b.count)).toEqual([11]);
    // Buys 1–10 each give one of the ten new cards; buy 11 shares one copy across all eleven cards you own by then.
    expect(plan.expectedGains.get('d0')).toBeCloseTo(1 + 1 / 11);
    expect(plan.expectedGains.get('owned')).toBeCloseTo(1 / 11);
  });

  // Value: protects=the planner stops buying a Kasket of threshold gear once its planned buys own every piece;
  // fails_when=packEV stops passing planned gains to the Kasket's pool; why_new=no planner test reaches a Kasket's 'none' pool; seam=none
  it('stops planning a Kasket of threshold gear once its buys are expected to give every piece', () => {
    const s = setup([card('e1', 0, { rarityId: 'epic' }), card('e2', 0, { rarityId: 'epic' })], [kasket('epic')], (s) => (s.currencies[0].balance = 1000));
    expect(buildPlan(buildCtx(s), NOW).currencies[0].buys.map((b) => b.count)).toEqual([2]);
  });

  // Value: protects=a card the plan's earlier buys max leaves the Kasket's unmaxed pool, so the rest share its odds;
  // fails_when=the unmaxed filter counts only saved levels, not planned gains; why_new=the switch test never maxes a card mid-plan; seam=none
  it('takes a card the plan is expected to max out of the pool for later buys', () => {
    const s = setup([card('near', F(9)), card('far', F(2))], [kasket('diamond')], (s) => (s.currencies[0].balance = 400));
    const plan = buildPlan(buildCtx(s), NOW);
    // Buys 1–2 split one copy each between the two; near is then at max, so buys 3–4 both go to far.
    expect(plan.expectedGains.get('near')).toBeCloseTo(1);
    expect(plan.expectedGains.get('far')).toBeCloseTo(3);
  });

  it('never gives Realm Klash gear', () => {
    // sash is listed; sold is ordinary gear that happens to be sold for Blood Rubies, so Kaskets can give it.
    const s = setup(
      [card('sash', 0, { rarityId: 'epic', name: 'Shadow Sash' }), card('sold', 0, { rarityId: 'epic' }), card('kunai', 0, { rarityId: 'epic' })],
      [kasket('epic'), pack('store', [{ cardId: 'sold', chance: 100 }], { store: true, currencyId: 'blood-rubies' })],
    );
    expect(ids(kasketPool(buildCtx(s), s.packs[0]).cards)).toEqual(['sold', 'kunai']);
  });

  it('puts gear only a Kasket gives in the priority targets', () => {
    const s = setup([card('tower', 0, { rarityId: 'epic', source: 'tower' })], [kasket('epic')]);
    expect(rankTargets(buildCtx(s), NOW).map((t) => [t.card.id, t.inPacks])).toEqual([['tower', 1]]);
  });

  it('says in words how many cards share the odds, or why it isn’t valued', () => {
    const line = (cards: Card[], rarity: string) => {
      const s = setup(cards, [kasket(rarity)]);
      return kasketLine(kasketPool(buildCtx(s), s.packs[0]));
    };
    expect(line([card('a', 0), card('b', 0)], 'diamond')).toBe("New card: 1 in 2 of the Diamond characters you don't own");
    expect(line([card('a', F(2), { rarityId: 'gold' }), card('b', F(4), { rarityId: 'gold' })], 'gold')).toBe("You own them all: 1 in 2 of your Gold characters you haven't maxed");
    expect(line([card('a', 0)], 'diamond')).toBe("New card: the only Diamond character you don't own");
    expect(line([card('a', F(2), { rarityId: 'gold' })], 'gold')).toBe("You own them all: your only Gold character you haven't maxed");
    expect(line([card('e', F(2), { rarityId: 'epic' }), card('x', 0, { rarityId: 'epic', name: 'Man in Control' })], 'epic')).toBe(
      "You own every Epic gear piece it gives, so this isn't valued",
    );
    expect(line([card('x', F(3), { name: 'Sub-Zero MK1' })], 'diamond')).toBe('Nothing left in this Kasket that MK Max tracks');
    expect(line([], 'gone')).toBe("This Kasket's rarity no longer exists, so it isn't valued");
  });

  it("offers every card of a Kasket's rarity in its pull search, the ones it can give first", () => {
    const cards = [card('new', 0), card('owned', F(2)), card('newest', 0, { name: 'Sub-Zero MK1' }), card('g', 0, { rarityId: 'gold' })];
    const s = setup(cards, [kasket('diamond'), kasket('gone')]);
    const ctx = buildCtx(s);
    const pull = kasketPullCards(ctx, s.packs[0]);
    expect([...pull.exclude]).toEqual(['g']);
    expect([...pull.first]).toEqual(['new']);
    // Its rarity removed: nothing to put first, and nothing hidden.
    expect(kasketPullCards(ctx, s.packs[1])).toEqual({ exclude: new Set(), first: new Set() });
  });

  it('says a Kasket of new cards gives each one within its pool size, not by repeat-based averages', () => {
    const s = setup([card('a', 0), card('b', 0), card('c', 0), card('g', F(2), { rarityId: 'gold' })], [kasket('diamond', { id: 'kd' }), kasket('gold', { id: 'kg' })]);
    const ranks = rankPacks(buildCtx(s), NOW);
    expect(ranks.find((r) => r.pack.id === 'kd')!.targets.map((t) => t.withinBuys)).toEqual([3, 3, 3]);
    // Once you own them all it gives unmaxed cards, which can repeat, so the usual average applies.
    expect(ranks.find((r) => r.pack.id === 'kg')!.targets[0].withinBuys).toBeUndefined();
    // Two buys left can't promise all three cards.
    s.packs[0] = { ...s.packs[0], maxPurchases: 5, purchased: 3 };
    expect(rankPacks(buildCtx(s), NOW).find((r) => r.pack.id === 'kd')!.targets[0].withinBuys).toBeUndefined();
  });

  it("doesn't value a Kasket of a Kameo rarity", () => {
    const s = setup([card('k', 0, { rarityId: 'kameo-diamond' })], [kasket('kameo-diamond')]);
    expect(kasketPool(buildCtx(s), s.packs[0])).toMatchObject({ mode: 'none', cards: [] });
  });

  it('saves a Kasket without the drops or cards per purchase typed before ticking it', () => {
    const s = setup([card('a', 0)]);
    savePack(s, pack('k', [{ cardId: 'a', chance: 40 }], { kasket: 'diamond', rolls: 3 }), null, NOW);
    expect(s.packs[0]).toMatchObject({ kasket: 'diamond', rolls: 1, drops: [] });
  });

  it('removes the Kaskets of a removed rarity, leaving other packs', () => {
    const s = setup([], [kasket('epic', { id: 'epic-k' }), kasket('diamond', { id: 'diamond-k' }), pack('p', [])]);
    removeRarity(s, 'epic');
    expect(s.rarities.map((r) => r.id)).not.toContain('epic');
    expect(s.packs.map((p) => p.id)).toEqual(['diamond-k', 'p']);
  });
});

describe('kard plan notes', () => {
  const epic: RarityRule = { ...rules().get('epic')!, goal: 'max', fusionUpKards: 60 };
  const diamond: RarityRule = { ...rules().get('diamond')!, fusionUpKards: 10 };
  const gear = (id: string, name: string, fusion: number, extra: Partial<Card> = {}) => card(id, fusion, { rarityId: 'epic', name, ...extra });
  const cards = new Map(
    [gear('hood', 'Lin Kuei Hood', F(8)), gear('mask', 'Dragon Mask', F(7)), gear('sword', 'Ninja Sword', F(3)), gear('ring', 'Kori Ring', F(3), { maxLevel: F(4) })].map((c) => [c.id, c]),
  );
  const row = { cardId: 'hood', from: F(8), to: F(10), kards: 27 };
  const plan = (p: Partial<KardPlan>): KardPlan => ({ assignments: [], left: 0, cards: 1, cheapest: 1, realmKlash: 0, ...p });

  // Value: protects=the exact sentences under each rarity in the Fusion Up Kard plan, in order; fails_when=a branch shows the
  // wrong note, drops one (next and stuck together), gets the shortfall or kard/kards wrong, or adds "more" at 0 left;
  // why_new=the sentences were built inline in PlanView with no test; seam=none; no_claim=how PlanView lays the notes out (browser QA)
  it('writes the notes for each case of the plan', () => {
    const stuckLine = (name: string) => `${name} can't reach F10 with kards: a step on the way has no kard cost in Settings → Fusion rules.`;
    const cases: [string, KardPlan, RarityRule, string[]][] = [
      ['no card yet', plan({ cards: 0, left: 60 }), epic, ['No Epic Equip card at F3 or higher yet, so these kards wait.']],
      [
        'no card but Realm Klash gear',
        plan({ cards: 0, left: 60, realmKlash: 1 }),
        epic,
        ['No Epic Equip card at F3 or higher that kards can go to yet, so these kards wait. Realm Klash gear gets none.'],
      ],
      [
        'not enough to finish a piece',
        plan({ left: 20, next: { cardId: 'hood', needs: 27 } }),
        epic,
        ['Not enough kards to finish a piece yet: Lin Kuei Hood needs 27 to reach F10, 7 more than you have.'],
      ],
      ['one stuck piece', plan({ left: 60, stuck: ['mask'] }), epic, [stuckLine('Dragon Mask')]],
      [
        'several stuck pieces',
        plan({ left: 60, stuck: ['mask', 'hood', 'sword'] }),
        epic,
        ["Dragon Mask and 2 more can't reach their goal with kards: a step on the way has no kard cost in Settings → Fusion rules."],
      ],
      [
        'next and stuck with no rows',
        plan({ left: 5, next: { cardId: 'hood', needs: 27 }, stuck: ['mask'] }),
        epic,
        ['Not enough kards to finish a piece yet: Lin Kuei Hood needs 27 to reach F10, 22 more than you have.', stuckLine('Dragon Mask')],
      ],
      ['a character step too dear', plan({ left: 1, cheapest: 2 }), diamond, ['Not enough kards for any step yet: the cheapest next step costs 2.']],
      ['no step costs known', plan({ left: 1, cheapest: null }), diamond, ['Not enough kards for any step yet.']],
      [
        'next with kards left',
        plan({ assignments: [row], left: 33, next: { cardId: 'mask', needs: 36 } }),
        epic,
        ['Next: Dragon Mask needs 36 kards to reach F10, 3 more than you have left.'],
      ],
      ['next with none left', plan({ assignments: [row], left: 0, next: { cardId: 'mask', needs: 36 } }), epic, ['Next: Dragon Mask needs 36 kards to reach F10.']],
      ['next needing 1 kard', plan({ assignments: [row], left: 0, next: { cardId: 'ring', needs: 1 } }), epic, ['Next: Kori Ring needs 1 kard to reach F4.']],
      ['stuck after rows', plan({ assignments: [row], left: 33, stuck: ['mask'] }), epic, [stuckLine('Dragon Mask')]],
      ['rows and nothing else', plan({ assignments: [row], left: 33 }), epic, []],
    ];
    for (const [name, p, rule, notes] of cases) expect(kardNotes(p, rule, cards), name).toEqual(notes);
  });

  // Value: protects=the footer explains only the kinds of kards you hold; fails_when=the character or gear sentence shows
  // without kards of that kind, or is missing with them; why_new=built inline in PlanView with no test; seam=none;
  // no_claim=the "After fusing… tap Use" sentence that PlanView adds after it
  it('explains character and gear kards only for the kinds that have kards', () => {
    const chars = 'Character kards go to the cheapest steps first, since each step saves one pack copy. Guest cards count extra. ';
    const gearText = 'Gear kards finish one piece at a time, the one needing fewest kards first, since gear only gets its special effect at F10. ';
    expect(kardFooter([diamond])).toBe(chars);
    expect(kardFooter([epic])).toBe(gearText);
    expect(kardFooter([diamond, epic])).toBe(chars + gearText);
    expect(kardFooter([{ ...diamond, fusionUpKards: 0 }, epic])).toBe(gearText);
    expect(kardFooter([])).toBe('');
  });
});

describe('planner', () => {
  it('stays within budget and purchase limits, and prefers expiring packs', () => {
    const s = setup(
      [card('a', F(5)), card('b', F(5))],
      [
        pack('perm', [{ cardId: 'a', chance: 10 }]),
        pack('limited', [{ cardId: 'b', chance: 10 }], { endsAt: '2026-01-12T00:00', maxPurchases: 2 }),
        pack('gone', [{ cardId: 'a', chance: 90 }], { endsAt: '2026-01-01T00:00' }),
      ],
      (s) => (s.currencies[0].balance = 350),
    );
    const plan = buildPlan(buildCtx(s), NOW);
    const souls = plan.currencies.find((c) => c.currencyId === 'souls')!;
    expect(souls.spent).toBeLessThanOrEqual(350);
    expect(souls.buys.map((b) => [b.pack.id, b.count])).toEqual([
      ['limited', 2],
      ['perm', 1],
    ]);
    expect(souls.saveFor?.pack.id).toBe('perm');
    expect(souls.saveFor?.shortBy).toBe(50);
  });

  it("spends today's budget on a pack that hasn't started, as a Save for buy", () => {
    const s = setup([card('a', F(5))], [pack('soon', [{ cardId: 'a', chance: 20 }], { startsAt: '2026-01-11T00:00', endsAt: '2026-01-14T00:00' })], (s) => (s.currencies[0].balance = 200));
    const souls = buildPlan(buildCtx(s), NOW).currencies[0];
    expect(souls.buys.map((b) => [b.pack.id, b.status, b.count])).toEqual([['soon', 'upcoming', 2]]);
    expect(souls.spent).toBe(200);
  });

  it('lists buys soonest-ending first, permanent packs last', () => {
    const drops = (cardId: string) => [{ cardId, chance: 10 }];
    const s = setup(
      [card('a', F(5)), card('b', F(5)), card('c', F(5))],
      [pack('perm', drops('a')), pack('later', drops('b'), { endsAt: '2026-01-20T00:00', maxPurchases: 1 }), pack('sooner', drops('c'), { endsAt: '2026-01-12T00:00', maxPurchases: 1 })],
      (s) => (s.currencies[0].balance = 300),
    );
    expect(buildPlan(buildCtx(s), NOW).currencies[0].buys.map((b) => b.pack.id)).toEqual(['sooner', 'later', 'perm']);
  });

  it('stops buying once expected copies would max the card', () => {
    const s = setup([card('a', F(9))], [pack('p', [{ cardId: 'a', chance: 100 }])], (s) => (s.currencies[0].balance = 1000));
    const souls = buildPlan(buildCtx(s), NOW).currencies[0];
    expect(souls.buys[0].count).toBe(1);
  });
});

describe('buying from the plan', () => {
  it('records a store purchase: count, balance and the card', () => {
    const s = setup([card('a', F(2))], [pack('p', [{ cardId: 'a', chance: 100 }], { store: true })], (s) => (s.currencies[0].balance = 250));
    expect(recordPurchase(s, 'p', 1)).toBe(true);
    expect([s.packs[0].purchased, s.currencies[0].balance, s.cards[0].fusion]).toEqual([1, 150, F(3)]);
    expect(recordPurchase(s, 'p', -1)).toBe(true);
    expect([s.packs[0].purchased, s.currencies[0].balance, s.cards[0].fusion]).toEqual([0, 250, F(2)]);
    expect(recordPurchase(s, 'p', -1)).toBe(false);
  });

  it('gives back exactly what a buy took when the balance was too low for it', () => {
    const s = setup([card('a', F(2))], [pack('p', [{ cardId: 'a', chance: 50 }], { cost: 400 })], (s) => (s.currencies[0].balance = 200));
    recordPurchase(s, 'p', 1);
    expect(s.currencies[0].balance).toBe(-200);
    // The planner has nothing to spend, as at 0.
    const plan = buildPlan(buildCtx(s), NOW).currencies[0];
    expect([plan.startBalance, plan.spent, plan.buys.length, plan.saveFor?.shortBy]).toEqual([0, 0, 0, 400]);
    recordPurchase(s, 'p', -1);
    expect(s.currencies[0].balance).toBe(200);
  });

  it("leaves a random pack's cards to the pull step", () => {
    const s = setup([card('a', F(2))], [pack('p', [{ cardId: 'a', chance: 50 }])], (s) => (s.currencies[0].balance = 100));
    recordPurchase(s, 'p', 1);
    expect([s.packs[0].purchased, s.currencies[0].balance, s.cards[0].fusion]).toEqual([1, 0, F(2)]);
  });

  it('works out days to afford from a daily income', () => {
    expect(daysToAfford(130, 65)).toBe(2);
    expect(daysToAfford(131, 65)).toBe(3);
    expect(daysToAfford(100, undefined)).toBeNull();
    expect(daysToAfford(100, 0)).toBeNull();
  });

  it('forecasts when each gear piece is maxed, in gear order', () => {
    const step = (id: string, need: number, cost: number) => ({ card: card(id, 0), need, items: [pack(id, [], { cost }), pack(`${id}2`, [], { cost: cost * 2 })] });
    const gear = [step('sash', 2, 300), step('ball', 3, 300)];
    // 600 for the sash, 1,500 in all; 650 in hand and 65 a day.
    expect(gearForecast(gear, 650, 65)).toEqual([
      { cardId: 'sash', total: 600, days: 0 },
      { cardId: 'ball', total: 1500, days: 14 },
    ]);
    expect(gearForecast(gear, 0, undefined).map((g) => g.days)).toEqual([null, null]);
    expect(gearForecast(gear, -300, 65)).toEqual(gearForecast(gear, 0, 65));
  });

  it('adds the year to forecast dates outside this year', () => {
    const now = new Date('2026-10-02T12:00:00');
    expect(daysFromNow(14, now)).not.toMatch(/2026/);
    expect(daysFromNow(127, now)).toMatch(/2027/);
  });

  it('flags planned packs ending within a day', () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3600000).toISOString();
    const drops = [{ cardId: 'a', chance: 50 }];
    const s = setup([card('a', F(2))], [pack('soon', drops, { endsAt: at(5) }), pack('later', drops, { endsAt: at(30) }), pack('open', drops)], (s) => (s.currencies[0].balance = 1000));
    expect(endingSoon(buildPlan(buildCtx(s), NOW), NOW).map((p) => p.id)).toEqual(['soon']);
  });
});

describe('removing done cards', () => {
  it('drops cards at their goal, their pack drops, and store items that only sold them', () => {
    const s = setup(
      [card('maxed', F(10)), card('capped', A(5), { rarityId: 'gold', maxLevel: A(5) }), card('epic', F(3), { rarityId: 'epic' }), card('open', F(2))],
      [
        pack('store', [{ cardId: 'maxed', chance: 100 }], { store: true }),
        pack('random', [{ cardId: 'maxed', chance: 20 }, { cardId: 'open', chance: 5 }]),
      ],
    );
    expect(pruneDone(s).sort()).toEqual(['capped', 'epic', 'maxed']);
    expect(s.cards.map((c) => c.id)).toEqual(['open']);
    expect(s.packs.map((p) => p.id)).toEqual(['random']);
    expect(s.packs[0].drops).toEqual([{ cardId: 'open', chance: 5 }]);
  });

  it('leaves everything alone when nothing is done', () => {
    const s = setup([card('open', F(2))], [pack('p', [{ cardId: 'open', chance: 5 }])]);
    expect(pruneDone(s)).toEqual([]);
    expect(s.cards).toHaveLength(1);
  });
});

describe('Realm Klash seasons', () => {
  it('rolls the season end forward 2 weeks at a time', () => {
    expect(seasonEnd(null, NOW)).toBeNull();
    expect(seasonEnd('2026-01-12T20:00', NOW)).toBe('2026-01-12T20:00'); // still running
    expect(seasonEnd('2026-01-10T11:00', NOW)).toBe('2026-01-24T11:00'); // ended an hour ago
    expect(seasonEnd('2025-12-01T20:00', NOW)).toBe('2026-01-12T20:00'); // three seasons later
  });

  it('ends a season early: its items expire, older seasons keep their dates, and the next season runs 2 weeks', () => {
    const s = setup([], [
      pack('now', [], { season: true, endsAt: '2026-01-12T20:00' }),
      pack('last', [], { season: true, endsAt: '2025-12-29T20:00' }),
      pack('gear', [], { season: false, endsAt: null }),
    ], (s) => (s.realmKlashSeasonEnd = '2025-12-29T20:00'));
    moveSeasonEnd(s, '2026-01-10T11:59', NOW);
    expect(s.packs.map((p) => p.endsAt)).toEqual(['2026-01-10T11:59', '2025-12-29T20:00', null]);
    expect(packStatus(s.packs[0], NOW)).toBe('expired');
    expect(seasonEnd(s.realmKlashSeasonEnd, NOW)).toBe('2026-01-24T11:59');
  });

  it('moves items still on the saved end when the schedule extended the season after that end passed', () => {
    // The schedule listed one week of a season ending Jan 10 11:00; a second week was added after it passed.
    const s = setup([], [
      pack('this', [], { season: true, endsAt: '2026-01-10T11:00' }),
      pack('before', [], { season: true, endsAt: '2026-01-03T11:00' }),
      pack('guess', [], { season: true, endsAt: '2026-01-24T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    moveSeasonEnd(s, '2026-01-17T11:00', NOW, ['2026-01-10T11:00']);
    // The season before ended at this season's start, so its items stay.
    expect(s.packs.map((p) => p.endsAt)).toEqual(['2026-01-17T11:00', '2026-01-03T11:00', '2026-01-17T11:00']);
    expect(s.realmKlashSeasonEnd).toBe('2026-01-17T11:00');
  });

  it("leaves the last season's items alone when its end was set a little after the real changeover", () => {
    // Ended early tapped at 11:00; the schedule then lists a new season that started at 10:00.
    const s = setup([], [pack('last', [], { season: true, endsAt: '2026-01-10T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    moveSeasonEnd(s, '2026-01-17T10:00', NOW, []);
    expect(s.packs[0].endsAt).toBe('2026-01-10T11:00');
  });

  it('keeps an item entered ahead in the season it starts in when the current season moves', () => {
    const end = '2026-01-12T20:00';
    const ahead = () => {
      const s = setup([], [], (s) => (s.realmKlashSeasonEnd = end));
      // Next season's character, and one starting partway through the season after.
      for (const p of [pack('next', [], { currencyId: 'blood-rubies', startsAt: end }), pack('later', [], { currencyId: 'blood-rubies', startsAt: '2026-01-30T10:00' })])
        savePack(s, { ...p, endsAt: packEndOnSave(p, true, end, NOW) }, null, NOW);
      expect(s.packs.map((p) => p.endsAt)).toEqual(['2026-01-26T20:00', '2026-02-09T20:00']);
      return s;
    };
    const dates = (s: AppState) => s.packs.map((p) => [p.startsAt, p.endsAt]);
    // A corrected timer: the changeover moves a day, and so does next season.
    const fixed = ahead();
    moveSeasonEnd(fixed, '2026-01-13T20:00', NOW);
    expect(dates(fixed)).toEqual([['2026-01-13T20:00', '2026-01-27T20:00'], ['2026-01-30T10:00', '2026-02-10T20:00']]);
    // Ended early: next season starts now and runs 2 weeks.
    const early = ahead();
    moveSeasonEnd(early, '2026-01-10T11:59', NOW);
    expect(dates(early)).toEqual([['2026-01-10T11:59', '2026-01-24T11:59'], ['2026-01-30T10:00', '2026-02-07T11:59']]);
    // A later move still finds them: moving the corrected timer back puts them back.
    moveSeasonEnd(fixed, end, NOW);
    expect(dates(fixed)).toEqual([[end, '2026-01-26T20:00'], ['2026-01-30T10:00', '2026-02-09T20:00']]);
  });

  it('moves an item entered ahead whose end came from the schedule', () => {
    // Next season was listed as one week, then the current season was extended a week.
    const s = setup([], [pack('next', [], { season: true, startsAt: '2026-01-12T20:00', endsAt: '2026-01-19T20:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-12T20:00'));
    moveSeasonEnd(s, '2026-01-19T20:00', NOW);
    expect([s.packs[0].startsAt, s.packs[0].endsAt]).toEqual(['2026-01-19T20:00', '2026-02-02T20:00']);
  });

  it('moves an item entered ahead when the schedule extends the season after its saved end passed', () => {
    const s = setup([], [pack('next', [], { season: true, startsAt: '2026-01-10T11:00', endsAt: '2026-01-24T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    moveSeasonEnd(s, '2026-01-17T11:00', NOW, ['2026-01-10T11:00']);
    expect([s.packs[0].startsAt, s.packs[0].endsAt]).toEqual(['2026-01-17T11:00', '2026-01-31T11:00']);
  });

  it('assumes Blood Ruby characters, Kameos and Kameo packs rotate, but not the gear', () => {
    const s = setup([card('hero', F(2)), card('gear', F(5), { rarityId: 'epic', goal: 'max' }), card('kameo', 0, { rarityId: 'kameo-gold' })]);
    const item = (cardId: string) => pack(cardId, [{ cardId, chance: 100 }], { currencyId: 'blood-rubies', store: true });
    expect(suggestSeason(item('hero'), s)).toBe(true);
    expect(suggestSeason(item('kameo'), s)).toBe(true);
    expect(suggestSeason(item('gear'), s)).toBe(false);
    expect(suggestSeason(pack('kameo pack', [], { currencyId: 'blood-rubies' }), s)).toBe(true);
    expect(suggestSeason(pack('souls pack', []), s)).toBe(false);
  });
});

describe('saving a pack from the editor', () => {
  const rk = (id: string, extra: Partial<Pack> = {}) => pack(id, [], { currencyId: 'blood-rubies', ...extra });

  it('keeps a purchase or season move made while the editor was open, unless that field was changed', () => {
    const opened = pack('p', [], { purchased: 1, endsAt: '2026-01-12T20:00' });
    const live = { ...opened, purchased: 2, endsAt: '2026-01-11T20:00' };
    expect(editedPack({ ...opened, cost: 50 }, live, {})).toMatchObject({ cost: 50, purchased: 2, endsAt: '2026-01-11T20:00' });
    expect(editedPack({ ...opened, purchased: 5, endsAt: null }, live, { purchased: true, endsAt: true })).toMatchObject({ purchased: 5, endsAt: null });
    // Set back to what it was when the editor opened, it's still the user's choice.
    expect(editedPack(opened, live, { purchased: true }).purchased).toBe(1);
    // New packs, and ones deleted meanwhile, are saved as entered.
    expect(editedPack(opened, undefined, {}).purchased).toBe(1);
  });

  it('gives a seasonal pack the current season end, and an ended season or a non-seasonal pack keeps its own', () => {
    const end = '2026-01-12T20:00';
    expect(packEndOnSave(rk('now'), true, end, NOW)).toBe(end);
    expect(packEndOnSave(rk('old', { endsAt: '2025-12-29T20:00' }), true, end, NOW)).toBe('2025-12-29T20:00');
    expect(packEndOnSave(rk('gear', { endsAt: null }), false, end, NOW)).toBeNull();
    // No season end entered yet: it stays as it is.
    expect(packEndOnSave(rk('now', { endsAt: null }), true, null, NOW)).toBeNull();
  });

  it('gives an item that starts after this season the end of the season it starts in', () => {
    const end = '2026-01-12T20:00';
    expect(packEndOnSave(rk('next', { startsAt: end }), true, end, NOW)).toBe('2026-01-26T20:00');
    expect(packEndOnSave(rk('later', { startsAt: '2026-01-30T10:00' }), true, end, NOW)).toBe('2026-02-09T20:00');
    // The schedule's date when it lists that whole season, even a one-week season.
    expect(packEndOnSave(rk('next', { startsAt: end }), true, end, NOW, { end: '2026-01-19T20:00', complete: true })).toBe('2026-01-19T20:00');
    // The site lists only next season's first week: that's not its end, so it gets 2 weeks, or longer if listed.
    expect(packEndOnSave(rk('next', { startsAt: end }), true, end, NOW, { end: '2026-01-19T20:00', complete: false })).toBe('2026-01-26T20:00');
    expect(packEndOnSave(rk('next', { startsAt: end }), true, end, NOW, { end: '2026-02-02T20:00', complete: false })).toBe('2026-02-02T20:00');
    // Starting during this season: it still ends with this one.
    expect(packEndOnSave(rk('soon', { startsAt: '2026-01-11T10:00' }), true, end, NOW)).toBe(end);
  });

  it("shows the season end synced in until the field is changed, and the schedule's while it sets the season", () => {
    expect(editorSeasonEnd(null, undefined, '2026-01-13T20:00')).toBe('2026-01-13T20:00');
    expect(editorSeasonEnd(null, '2026-01-14T20:00', '2026-01-13T20:00')).toBe('2026-01-14T20:00');
    expect(editorSeasonEnd(null, '', '2026-01-13T20:00')).toBe('');
    expect(editorSeasonEnd('2026-01-15T20:00', '2026-01-14T20:00', '2026-01-13T20:00')).toBe('2026-01-15T20:00');
  });

  it('moves the season on save only to a valid date changed in the editor', () => {
    const o = { seasonal: true, pastSeason: false, scheduled: null, edited: '2026-01-14T20:00', currentEnd: '2026-01-12T20:00' };
    expect(seasonMoveOnSave(o)).toBe('2026-01-14T20:00');
    // Untouched, even after a move synced in while the editor was open.
    expect(seasonMoveOnSave({ ...o, edited: undefined, currentEnd: '2026-01-13T20:00' })).toBeNull();
    expect(seasonMoveOnSave({ ...o, edited: '2026-01-12T20:00' })).toBeNull();
    expect(seasonMoveOnSave({ ...o, scheduled: '2026-01-12T20:00' })).toBeNull();
    expect(seasonMoveOnSave({ ...o, pastSeason: true })).toBeNull();
    expect(seasonMoveOnSave({ ...o, seasonal: false })).toBeNull();
    expect(seasonMoveOnSave({ ...o, edited: '' })).toBeNull();
    expect(seasonMoveOnSave({ ...o, edited: '2026-13-45T20:00' })).toBeNull();
  });

  it('adds or replaces the pack, and moves the season only when told to', () => {
    const end = '2026-01-12T20:00';
    const s = setup([], [rk('a', { season: true, endsAt: end }), rk('b', { season: true, endsAt: end })], (s) => (s.realmKlashSeasonEnd = end));
    savePack(s, { ...rk('a', { season: true, endsAt: end }), name: '  A  ', cost: 50 }, null, NOW);
    expect([s.packs[0].name, s.packs[0].cost, s.packs[1].endsAt, s.realmKlashSeasonEnd]).toEqual(['A', 50, end, end]);
    savePack(s, rk('c', { endsAt: end }), '2026-01-13T20:00', NOW);
    expect(s.packs.map((p) => [p.id, p.season, p.endsAt])).toEqual([
      ['a', true, '2026-01-13T20:00'],
      ['b', true, '2026-01-13T20:00'],
      ['c', true, '2026-01-13T20:00'],
    ]);
    expect(s.realmKlashSeasonEnd).toBe('2026-01-13T20:00');
    // A pack moved off Blood Rubies loses its season flag.
    savePack(s, { ...s.packs[0], currencyId: 'souls' }, null, NOW);
    expect(s.packs[0].season).toBeUndefined();
  });

  it('splits an even pool, adding a share to cards already listed', () => {
    expect(poolShare(9, 6, 2)).toBe(1.5);
    expect(poolShare(9, null, 3)).toBe(3); // blank size: the picked cards are the whole pool
    expect(poolShare(9, 2, 3)).toBe(3); // never fewer items than picked
    expect(poolShare(null, 6, 2)).toBe(0);
    expect(poolShare(9, 6, 0)).toBe(0);
    expect(addPool([{ cardId: 'a', chance: 1.5 }, { cardId: 'x', chance: 2 }], ['a', 'b'], 1.5)).toEqual([
      { cardId: 'a', chance: 3 },
      { cardId: 'x', chance: 2 },
      { cardId: 'b', chance: 1.5 },
    ]);
  });
});
