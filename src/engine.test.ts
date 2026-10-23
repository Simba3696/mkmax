import { describe, expect, it } from 'vitest';
import { ASCENSION_KARD_COSTS, DIAMOND_KARD_COSTS, GEAR_KARD_COSTS, defaultState } from './defaults';
import {
  addPool, ascensionCaps, respellTower, towerSpellings, atTopLevel, buildCtx, cardGoal, onMaxedRecord, recordMaxed, unmarkMaxed, entryGoal, buildPlan, cardWeight, copiesAtFusion, editedPack, editorSeasonEnd, fuseWithKards, gearQueue, gearWaiting, kardCost, kardStep, kasketPool, kasketPullCards, copiesToMax, copiesToThreshold, copyPhase, daysToAfford, endingSoon, gearForecast, fLevel as F, isMaxed, isRealmKlashGear, keepWhenExpired, levelLabel, moveSeasonEnd, packDrops, packEndOnSave, packEV, packStatus, poolShare, pruneDone, rankPacks, rankTargets, recordPurchase, removeRarity, moveRarity, savePack, seasonEnd, seasonMoveOnSave, stretchedWeekEnds, suggestSeason, moveInGearOrder, stepCard, targetLevel,
} from './engine';
import { isKasketExcluded } from './kaskets';
import { kardTable, normalize } from './normalize';
import { daysFromNow, kardFooter, kardNotes, kasketLine, targetLine } from './ui';
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

  // Value: protects=a card's own Goal of Max beats its rarity's F3; fails_when=targetLevel, copiesToMax or isMaxed ignore
  // card.goal; why_new=cardGoal now also reads the Realm Klash list; seam=none; no_claim=the Goal control (browser QA)
  it('lets a card override its rarity goal', () => {
    const epic = rules().get('epic')!;
    const rk = card('rk', F(7), { rarityId: 'epic', goal: 'max' });
    expect(targetLevel(rk, epic)).toBe(F(10));
    expect(copiesToMax(rk, epic)).toBe(3);
    expect(isMaxed(rk, epic)).toBe(false);
  });

  // Value: protects=a card entered at or past its kard threshold while tracked only that far is tracked to its max, and
  // every other card keeps its goal; fails_when=it keeps the F3 goal (done the moment it's saved), or a card below the
  // threshold, one already set to Max, or a rarity with no threshold gets Max too; why_new=new rule (user request,
  // 2026-10-14); seam=none; no_claim=the screens that call it (CardsView and PacksView tests)
  it('tracks a card entered at or past its threshold on to its max', () => {
    const epic = rules().get('epic')!;
    const gold = { ...rules().get('gold')!, goal: 'threshold' as const };
    expect(entryGoal(card('e', F(2), { rarityId: 'epic' }), epic)).toBeUndefined();
    expect(entryGoal(card('e', F(3), { rarityId: 'epic' }), epic)).toBe('max');
    expect(entryGoal(card('e', F(7), { rarityId: 'epic', goal: 'threshold' }), epic)).toBe('max');
    expect(entryGoal(card('e', F(7), { rarityId: 'epic', goal: 'max' }), epic)).toBe('max');
    // A Gold card goes on to its own cap.
    const a5 = card('g', F(4), { rarityId: 'gold', maxLevel: A(5) });
    expect(entryGoal(a5, gold)).toBe('max');
    expect(targetLevel({ ...a5, goal: entryGoal(a5, gold) }, gold)).toBe(A(5));
    // A rarity tracked to Max, or one with no kards, keeps what it had.
    expect(entryGoal(card('d', F(5), { rarityId: 'diamond' }), rules().get('diamond')!)).toBeUndefined();
    expect(entryGoal(card('k', 1, { rarityId: 'kameo-gold' }), rules().get('kameo-gold')!)).toBeUndefined();
  });
});

describe('the Maxed record', () => {
  // Value: protects=a card leaving the list at its top level goes on the Maxed record, dated, once; gear done at its kard
  // threshold and a Kameo's absence aren't recorded; fails_when=pruneDone records cards done at F3 (not maxed), skips an
  // owned Kameo or a Gold card at its own cap, or records one twice; why_new=the Maxed record is new; seam=none
  it('records cards that leave at their top level, and not gear done at F3', () => {
    const s = setup([
      card('d', F(10)),
      card('g', A(5), { rarityId: 'gold', maxLevel: A(5) }),
      card('k', 1, { rarityId: 'kameo-gold', name: 'Jade, Lizard' }),
      card('e', F(3), { rarityId: 'epic', name: 'Kori Blade' }),
      card('still', F(4)),
    ]);
    expect(pruneDone(s, new Date('2026-10-18T09:00:00'))).toEqual(['d', 'g', 'Jade, Lizard', 'Kori Blade']);
    expect(s.maxed).toEqual([
      { name: 'd', rarityId: 'diamond', at: '2026-10-18' },
      { name: 'g', rarityId: 'gold', at: '2026-10-18' },
      { name: 'Jade, Lizard', rarityId: 'kameo-gold', at: '2026-10-18' },
    ]);
    // Already on the record (same rarity, name in another order): not added again. Found done on a load: no date.
    s.cards = [card('x', F(10), { name: 'D' }), card('y', F(10), { name: 'Raiden, Dark' })];
    pruneDone(s);
    expect(s.maxed!.map((m) => [m.name, m.at ?? null])).toEqual([['d', '2026-10-18'], ['g', '2026-10-18'], ['Jade, Lizard', '2026-10-18'], ['Raiden, Dark', null]]);
  });

  // Value: protects=a card back in the list (pasted again for a new Stage, say) comes off the record, and hand-added ones
  // aren't doubled; fails_when=a card is both in the list and counted as maxed, or pasting twice doubles it; why_new=the
  // Maxed record is new; seam=none
  it('takes a card back in the list off the record, and adds pasted ones once', () => {
    const s = setup([]);
    recordMaxed(s, [{ name: 'Kenshi, Elder God', rarityId: 'gold' }, { name: 'Kori Blade', rarityId: 'epic' }, { name: 'elder god kenshi', rarityId: 'gold' }]);
    expect(s.maxed).toEqual([{ name: 'Kenshi, Elder God', rarityId: 'gold' }, { name: 'Kori Blade', rarityId: 'epic' }]);
    unmarkMaxed(s, [card('k', A(5), { rarityId: 'gold', name: 'Elder God Kenshi' }), card('o', 0, { rarityId: 'rare', name: 'Kori Blade' })]);
    expect(s.maxed).toEqual([{ name: 'Kori Blade', rarityId: 'epic' }]);
  });

  // Generated by /ship review fixes on 2026-10-18; changed by /ship review fixes (cycle 3) on 2026-10-18
  // Value: protects=a card on the record is on it at any level and name order, and the record is never changed in place,
  // so its cached keys stay right after pruneDone or recordMaxed add to it; fails_when=onMaxedRecord misses a card just
  // maxed (stale keys), or only checks not-owned cards; why_new=review found the stale cache; seam=none; no_claim=the screens
  it('finds a card on the record at any level, and sees cards just added to it', () => {
    const s = setup([card('d', F(10))]);
    s.maxed = [{ name: 'Kori Blade', rarityId: 'epic' }];
    expect([atTopLevel(s.cards[0], s.rarities[0]), onMaxedRecord(s, { name: 'blade kori', rarityId: 'epic' }), onMaxedRecord(s, { name: 'd', rarityId: 'diamond' })]).toEqual([true, true, false]);
    pruneDone(s, new Date('2026-10-18T09:00:00'));
    recordMaxed(s, [{ name: 'g', rarityId: 'gold' }]);
    expect([onMaxedRecord(s, { name: 'd', rarityId: 'diamond' }), onMaxedRecord(s, { name: 'g', rarityId: 'gold' })]).toEqual([true, true]);
  });

  // Generated by /ship review fixes on 2026-10-18
  // Value: protects=gear tracked to F10 (Track until Max) that leaves at F10 is recorded, and pruneDone names the maxed
  // cards apart from gear only done at F3, for the Undo; fails_when=equipment is never recorded, or F3 gear is called
  // maxed; why_new=the record test had only gear done at F3; seam=none; no_claim=the Undo wording (CardsView.test.tsx)
  it('records gear finished to F10, and says which removed cards were maxed', () => {
    const s = setup([card('g', F(10), { rarityId: 'epic', name: 'Kori Blade', goal: 'max' }), card('e', F(3), { rarityId: 'rare', name: 'Hook Swords' })]);
    // Card by card, not by name: a same-named Rare piece done at F3 is still only done.
    s.cards.push(card('r', F(3), { rarityId: 'rare', name: 'Kori Blade' }));
    const split = { maxed: [] as string[], done: [] as string[] };
    expect([pruneDone(s, new Date('2026-10-18T09:00:00'), split), split]).toEqual([['Kori Blade', 'Hook Swords', 'Kori Blade'], { maxed: ['Kori Blade'], done: ['Hook Swords', 'Kori Blade'] }]);
    expect(s.maxed).toEqual([{ name: 'Kori Blade', rarityId: 'epic', at: '2026-10-18' }]);
  });

  // Value: protects=version 17 loads older saves with an empty record and drops junk entries a hand-edited file could
  // hold; fails_when=the record is missing (views crash) or a bad entry is kept; why_new=the record is new; seam=none
  it('loads an older save with an empty record, and keeps only well-formed entries', () => {
    const old = { ...defaultState(), version: 16 } as unknown as AppState;
    delete (old as Partial<AppState>).maxed;
    expect([normalize(old).version, normalize(old).maxed]).toEqual([18, []]);
    const odd = normalize({ ...old, maxed: [{ name: 'Kori Blade', rarityId: 'epic' }, { name: 3 }, null, 'x'] } as unknown as AppState);
    expect(odd.maxed).toEqual([{ name: 'Kori Blade', rarityId: 'epic' }]);
    // A day that isn't text would break the page, and the same card twice would list twice: one entry, with the day a
    // later copy has.
    const twice = normalize({ ...old, maxed: [{ name: 'Kori Blade', rarityId: 'epic', at: {}, extra: 1 }, { name: 'kori blade', rarityId: 'epic', at: '2026-10-01' }] } as unknown as AppState);
    expect(twice.maxed).toEqual([{ name: 'Kori Blade', rarityId: 'epic', at: '2026-10-01' }]);
    // Loading a save again changes nothing (save-migration: a current save comes out unchanged).
    expect(normalize(structuredClone(twice))).toEqual(twice);
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=version 18 saves every tower gear card's tower in the spelling the Tower list shows (the first shown
  // card naming it), trimmed, hidden cards too, and leaves other sources and a newer save alone; fails_when=old mixed
  // spellings survive, so the spelling shown flips when the card it came from leaves the list, or the step runs again on
  // a current save; why_new=review (Red Team) of mixed spellings in older saves; seam=none; no_claim=none beyond protects
  it('saves each tower in the spelling the Tower list shows, once', () => {
    const gear = (id: string, sourceNote: string | undefined, rarityId = 'epic', source: Card['source'] = 'tower') => card(id, 1, { rarityId, source, sourceNote });
    const old = {
      ...defaultState(),
      version: 17,
      cards: [
        gear('a', 'lin kuei tower '),
        gear('b', 'Lin Kuei Tower'),
        gear('c', 'LIN KUEI TOWER', 'gone'),
        gear('d', ' Wind Tower', 'gone'),
        gear('e', 'wind tower', 'gone'),
        gear('f', 'Shirai Ryu Tower', 'epic', 'krypt'),
        gear('g', undefined),
      ],
    } as unknown as AppState;
    const out = normalize(old);
    expect([out.version, out.cards.map((c) => c.sourceNote)]).toEqual([18, ['lin kuei tower', 'lin kuei tower', 'lin kuei tower', 'Wind Tower', 'Wind Tower', 'Shirai Ryu Tower', undefined]]);
    // A save already at version 18 isn't re-spelled again (a spelling typed since stands).
    const current = { ...old, version: 18 } as unknown as AppState;
    expect(normalize(current).cards.map((c) => c.sourceNote)).toEqual(['lin kuei tower ', 'Lin Kuei Tower', 'LIN KUEI TOWER', ' Wind Tower', 'wind tower', 'Shirai Ryu Tower', undefined]);
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

  // Value: protects=Blood Rubies max Realm Klash gear before buying a Kameo; fails_when=the Kameo item, listed first, is
  // bought before the gear; why_new=the gear is now recognised by name; seam=none; no_claim=the gear's buying order
  it('get Blood Rubies only after the Realm Klash gear', () => {
    const s = setup(
      [card('gear', F(8), { rarityId: 'epic', name: 'Shadow Sash' }), kameo('k')],
      [
        pack('kameo-item', [{ cardId: 'k', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
        pack('gear-item', [{ cardId: 'gear', chance: 100 }], { currencyId: 'blood-rubies', cost: 800, store: true }),
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
    const gear = (name: string, fusion: number) => card(name, fusion, { rarityId: 'epic', name });
    const item = (cardId: string, extra: Partial<Pack> = {}) =>
      pack(`${cardId} item`, [{ cardId, chance: 100 }], { currencyId: 'blood-rubies', cost: 500, store: true, ...extra });
    const rubies = (s: AppState) => buildPlan(buildCtx(s), NOW).currencies.find((c) => c.currencyId === 'blood-rubies')!;
    const cards = () => [gear('Bloody Tomahawk', F(8)), gear('Shadow Sash', F(8)), gear("Moloch's Ball and Chain", F(9)), kameo('k')];
    const packs = () => [item('Bloody Tomahawk'), item('Shadow Sash'), item("Moloch's Ball and Chain"), pack('kameo pack', [{ cardId: 'k', chance: 50 }], { currencyId: 'blood-rubies', cost: 100 })];
    const withRubies = (n: number) => (s: AppState) => void (s.currencies.find((c) => c.id === 'blood-rubies')!.balance = n);

    // Value: protects=Blood Rubies finish one piece before the next, in the default order; fails_when=rubies spread over
    // pieces or skip Shadow Sash; why_new=the pieces are listed by name; seam=none; no_claim=a saved order (below)
    it('maxes one piece at a time, Shadow Sash first by default', () => {
      const plan = rubies(setup(cards(), packs(), withRubies(1500)));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 2], ["Moloch's Ball and Chain item", 1]]);
      expect(plan.saveFor).toMatchObject({ pack: { id: 'Bloody Tomahawk item' }, shortBy: 500, gear: true });
    });

    // Value: protects=no Blood Ruby pack is bought while a listed piece still needs copies; fails_when=the Kameo pack is
    // bought before the Tomahawk's last copy; why_new=the pieces are listed by name; seam=none; no_claim=none
    it('buys no packs until every piece is maxed', () => {
      expect(rubies(setup(cards(), packs(), withRubies(2400))).buys.map((b) => b.pack.id)).toEqual([
        'Shadow Sash item', "Moloch's Ball and Chain item", 'Bloody Tomahawk item',
      ]); // 100 short of the Tomahawk's last copy, so the Kameo pack waits
      expect(rubies(setup(cards(), packs(), withRubies(2600))).buys.map((b) => b.pack.id)).toContain('kameo pack');
    });

    // Value: protects=the user's saved order beats the default; fails_when=Shadow Sash is bought before the moved Tomahawk;
    // why_new=the pieces are listed by name; seam=none; no_claim=the arrows on Settings (browser QA)
    it('follows the saved order', () => {
      const plan = rubies(setup(cards(), packs(), (s) => {
        withRubies(1000)(s);
        s.gearOrder = ['Bloody Tomahawk'];
      }));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Bloody Tomahawk item', 2]]);
      expect(plan.saveFor?.pack.id).toBe('Shadow Sash item');
    });

    // Value: protects=moving pieces with ↑/↓ keeps a piece that's off sale in its place; fails_when=the saved order lists
    // only pieces on sale, so the waiting piece drops below them when it's back; why_new=the move left GearOrder for the engine;
    // seam=none; no_claim=the arrows themselves (GearOrder screen)
    it('keeps a piece that is off sale in its place when two others trade places', () => {
      // Moloch's is first in the saved order but has no store item on sale.
      const s = setup(cards(), [item('Bloody Tomahawk'), item('Shadow Sash')], (s) => {
        s.gearOrder = ["Moloch's Ball and Chain", 'Shadow Sash', 'Bloody Tomahawk'];
      });
      expect(gearQueue(buildCtx(s), NOW).map((g) => g.card.id)).toEqual(['Shadow Sash', 'Bloody Tomahawk']);
      s.gearOrder = moveInGearOrder(s, 'Shadow Sash', 'Bloody Tomahawk', 1)!;
      expect(s.gearOrder).toEqual(["Moloch's Ball and Chain", 'Bloody Tomahawk', 'Shadow Sash']);
      // Back in the shop, it's first again.
      s.packs.push(item("Moloch's Ball and Chain"));
      expect(gearQueue(buildCtx(s), NOW).map((g) => g.card.id)).toEqual(["Moloch's Ball and Chain", 'Bloody Tomahawk', 'Shadow Sash']);
      // A piece without a saved place still sorts by the default order, and moving an unknown id changes nothing.
      expect(moveInGearOrder({ ...s, gearOrder: undefined }, 'Shadow Sash', "Moloch's Ball and Chain", 1)).toEqual(["Moloch's Ball and Chain", 'Shadow Sash', 'Bloody Tomahawk']);
      expect(moveInGearOrder(s, 'Shadow Sash', 'nope', 1)).toBeNull();
      expect(moveInGearOrder(s, 'Shadow Sash', 'Shadow Sash', 1)).toBeNull(); // past itself: nothing moves
    });

    // Regression: /ship review of todo-followups — a tap on a screen one move behind moved the piece back
    // Found by /ship on 2026-10-12
    // Value: protects=a tap whose piece is already on the arrow's side of its neighbour (the order changed after the screen
    // was drawn) moves nothing; fails_when=the direction is worked out from where the pieces sit now, so the piece jumps
    // back over its neighbour; why_new=review; seam=none; no_claim=the arrows themselves (GearOrder test)
    it('moves nothing when the tapped piece is already on the side its arrow points to', () => {
      const s = setup(cards(), [item('Bloody Tomahawk'), item('Shadow Sash')], (s) => {
        s.gearOrder = ['Bloody Tomahawk', 'Shadow Sash'];
      });
      // The screen still showed Shadow Sash first: ↓ on it, or ↑ on the Tomahawk, is already done.
      expect(moveInGearOrder(s, 'Shadow Sash', 'Bloody Tomahawk', 1)).toBeNull();
      expect(moveInGearOrder(s, 'Bloody Tomahawk', 'Shadow Sash', -1)).toBeNull();
      // The arrow that still has something to do works as usual.
      expect(moveInGearOrder(s, 'Shadow Sash', 'Bloody Tomahawk', -1)).toEqual(['Shadow Sash', 'Bloody Tomahawk', "Moloch's Ball and Chain"]);
    });

    // Regression: /ship review of clock-and-gear-taps — a stale tap moved a piece past one a sync had put on sale
    // Found by /ship on 2026-10-13
    // Value: protects=given the pieces on sale now, a tap only moves when its neighbour is still the next one on sale;
    // fails_when=only the side is checked, so the piece also jumps a piece the screen never showed between them; why_new=
    // review (Codex, adversarial); seam=none; no_claim=the arrows (GearOrder test)
    it('moves nothing when a sync put another piece on sale between the two', () => {
      const s = setup(cards(), [item('Shadow Sash'), item("Moloch's Ball and Chain"), item('Bloody Tomahawk')], (s) => {
        s.gearOrder = ['Shadow Sash', "Moloch's Ball and Chain", 'Bloody Tomahawk'];
      });
      const onSale = ['Shadow Sash', "Moloch's Ball and Chain", 'Bloody Tomahawk'];
      // The screen showed Shadow Sash next to the Tomahawk; Moloch's is on sale between them now.
      expect(moveInGearOrder(s, 'Shadow Sash', 'Bloody Tomahawk', 1, onSale)).toBeNull();
      expect(moveInGearOrder(s, 'Shadow Sash', "Moloch's Ball and Chain", 1, onSale)).toEqual(["Moloch's Ball and Chain", 'Shadow Sash', 'Bloody Tomahawk']);
    });

    // Regression: /review of stale-screens-and-schedule — ↓ still moved a piece a sync had taken off sale
    // Found by /review on 2026-10-13
    // Value: protects=a tap on a piece that's no longer on sale moves nothing, whichever arrow; fails_when=only the
    // neighbour is checked, so ↓ moves the off-sale piece when its neighbour is first on sale; why_new=review (testing,
    // maintainability, adversarial); seam=none; no_claim=the arrows (GearOrder test)
    it('moves nothing when a sync took the tapped piece off sale', () => {
      const s = setup(cards(), [item("Moloch's Ball and Chain"), item('Bloody Tomahawk')], (s) => {
        s.gearOrder = ['Shadow Sash', "Moloch's Ball and Chain", 'Bloody Tomahawk'];
      });
      const onSale = ["Moloch's Ball and Chain", 'Bloody Tomahawk'];
      expect(moveInGearOrder(s, 'Shadow Sash', "Moloch's Ball and Chain", 1, onSale)).toBeNull();
    });

    // Regression: review of todo-followups — the arrows swapped two places, so the other piece jumped over waiting ones
    // Found by /review on 2026-10-12
    // Value: protects=only the tapped piece moves, past its neighbour; fails_when=the two pieces swap places, so the one
    // not tapped drops below waiting pieces it was ahead of; why_new=review; seam=none; no_claim=the arrows (GearOrder test)
    it('moves only the tapped piece past its neighbour, over any waiting pieces between them', () => {
      // Shadow Sash and the Tomahawk are on sale; Moloch's and Devastator wait between them.
      const s = setup([...cards(), gear('Devastator', F(8))], [item('Shadow Sash'), item('Bloody Tomahawk')], (s) => {
        s.gearOrder = ['Shadow Sash', "Moloch's Ball and Chain", 'Devastator', 'Bloody Tomahawk'];
      });
      // ↑ on the Tomahawk: it goes just above Shadow Sash, which stays ahead of the waiting pieces.
      expect(moveInGearOrder(s, 'Bloody Tomahawk', 'Shadow Sash', -1)).toEqual(['Bloody Tomahawk', 'Shadow Sash', "Moloch's Ball and Chain", 'Devastator']);
      // ↓ on Shadow Sash: it goes just below the Tomahawk, which stays behind the waiting pieces.
      expect(moveInGearOrder(s, 'Shadow Sash', 'Bloody Tomahawk', 1)).toEqual(["Moloch's Ball and Chain", 'Devastator', 'Bloody Tomahawk', 'Shadow Sash']);
    });

    // Value: protects=listed gear gets Blood Rubies and no kards, even with Epic tracked to Max; fails_when=the Kard plan
    // assigns kards to a listed piece or the ruby buys change; why_new=gear is listed by name; seam=none; no_claim=none
    it('never spends Epic Fusion Up Kards on the gear', () => {
      const s = setup(cards(), packs(), (s) => {
        withRubies(1500)(s);
        const epic = s.rarities.find((r) => r.id === 'epic')!;
        epic.goal = 'max';
        epic.fusionUpKards = 50;
      });
      const ctx = buildCtx(s);
      expect(ctx.kardPlan.get('epic')?.assignments).toEqual([]);
      expect(rubies(s).buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 2], ["Moloch's Ball and Chain item", 1]]);
    });

    // Value: protects=a piece whose store item is out of purchases doesn't hold up the rest; fails_when=rubies stop at
    // Shadow Sash's limit; why_new=the pieces are listed by name; seam=none; no_claim=none
    it('moves on when a piece is out of purchases', () => {
      const ps = packs();
      ps[1].maxPurchases = 1;
      const plan = rubies(setup(cards(), ps, withRubies(1000)));
      expect(plan.buys.map((b) => [b.pack.id, b.count])).toEqual([['Shadow Sash item', 1], ["Moloch's Ball and Chain item", 1]]);
    });

    // Value: protects=next season's Rerun of a Realm Klash store item; fails_when=Clear expired deletes the item for a piece
    // still being bought (Rerun then has no drops or Store item, so Blood Rubies stop buying it) or keeps items for anything
    // else; why_new=the keep rule follows the name list; seam=PacksView Clear expired; no_claim=Rerun itself (events tests)
    it('keeps Realm Klash gear store items when clearing expired packs', () => {
      const s = setup([card('sash', F(5), { rarityId: 'epic', name: 'Shadow Sash' }), card('kori', F(5), { rarityId: 'epic', name: 'Kori Blade' }), card('d', F(4))]);
      const item = (cardId: string, extra: Partial<Pack> = { currencyId: 'blood-rubies', store: true }) => pack(`${cardId} item`, [{ cardId, chance: 100 }], extra);
      expect(keepWhenExpired(s, item('sash'))).toBe(true);
      expect(keepWhenExpired(s, item('sash', { currencyId: 'blood-rubies' }))).toBe(false); // not a store item
      expect(keepWhenExpired(s, item('sash', { currencyId: 'souls', store: true }))).toBe(false); // not sold for Blood Rubies
      expect(keepWhenExpired(s, item('kori'))).toBe(false); // gear that isn't on the list
      expect(keepWhenExpired(s, item('d'))).toBe(false); // a character
      expect(keepWhenExpired(s, item('gone'))).toBe(false); // the piece was maxed and deleted
      // Only the latest run: Rerun copies that one, so an older run of the same item clears.
      const run = (id: string, endsAt: string | null, name = 'Shadow Sash item') =>
        ({ ...pack(id, [{ cardId: 'sash', chance: 100 }], { currencyId: 'blood-rubies', store: true, endsAt }), name });
      const older = run('sash old', '2025-12-01T00:00');
      const newer = run('sash new', '2025-12-15T00:00');
      s.packs = [older, newer];
      expect([keepWhenExpired(s, older), keepWhenExpired(s, newer)]).toEqual([false, true]);
      // Value: protects=each piece keeps its own latest run; fails_when=a later run of another piece, or a later pack that isn't
      // a Blood Ruby store item, counts as this piece's newer run and Clear expired deletes the one Rerun needs; why_new=the
      // rows above only have runs of the same piece; seam=none; no_claim=equal end dates
      s.cards.push(card('dev', F(5), { rarityId: 'epic', name: 'Devastator' }));
      const devItem = { ...pack('dev new', [{ cardId: 'dev', chance: 100 }], { currencyId: 'blood-rubies', store: true, endsAt: '2026-01-05T00:00' }), name: 'Shadow Sash item' };
      const soulsSash = { ...pack('sash souls', [{ cardId: 'sash', chance: 100 }], { endsAt: '2026-01-05T00:00' }), name: 'Shadow Sash item' };
      s.packs = [older, newer, devItem, soulsSash];
      expect([keepWhenExpired(s, older), keepWhenExpired(s, newer), keepWhenExpired(s, devItem)]).toEqual([false, true, true]);
      // A current store item with no end date is newer than any expired run, so the expired one clears.
      s.packs = [newer, run('sash undated', null)];
      expect(keepWhenExpired(s, newer)).toBe(false);
      // Value: protects=Clear expired and Rerun agree on which run is the latest; fails_when=two runs with the same end
      // date are both kept, date formats are compared as text, or another item name's later run clears the only run of
      // this name that Rerun can find; why_new=adversarial review; seam=none; no_claim=Rerun itself (events tests)
      const sameEnd = [run('tie a', '2025-12-15T00:00'), run('tie b', '2025-12-15T00:00')];
      s.packs = sameEnd;
      expect(sameEnd.map((p) => keepWhenExpired(s, p))).toEqual([false, true]); // the one saved later stays
      // 09:00 at UTC-2 is 11:00 UTC, an hour after 10:00 UTC, though it sorts first as text.
      const utc = run('utc', '2025-12-15T10:00:00Z');
      const offset = run('offset', '2025-12-15T09:00:00-02:00');
      s.packs = [offset, utc];
      expect([keepWhenExpired(s, utc), keepWhenExpired(s, offset)]).toEqual([false, true]);
      const otherName = run('other name', '2026-01-01T00:00', 'Shadow Sash (season 2)');
      s.packs = [older, otherName];
      expect(keepWhenExpired(s, older)).toBe(true); // Rerun looks up 'Shadow Sash item' by name, so its last run stays
    });

    // Value: protects=Blood Rubies buy only the listed Realm Klash pieces; fails_when=other gear sold for Blood Rubies is
    // bought with rubies while the Kard plan also gives it kards; why_new=a store item no longer keeps kards off gear;
    // seam=none; no_claim=the buying order (gear-first tests)
    it('buys only Realm Klash gear with Blood Rubies', () => {
      const s = setup([gear('Shadow Sash', F(2)), gear('Kori Blade', F(2))], [item('Shadow Sash'), item('Kori Blade')]);
      expect(gearQueue(buildCtx(s), NOW).map((g) => g.card.id)).toEqual(['Shadow Sash']);
    });

    // Value: protects=the default Blood Ruby order however a listed name is typed; fails_when=a curly apostrophe or lower
    // case drops a piece to the end; why_new=the order is matched by key; seam=none; no_claim=a saved order (other tests)
    it('keeps the default buying order when a piece is typed with a curly apostrophe or in lower case', () => {
      const s = setup([gear('devastator', F(2)), gear('Moloch’s Ball and Chain', F(2))], [item('devastator'), item('Moloch’s Ball and Chain')]);
      expect(gearQueue(buildCtx(s), NOW).map((g) => g.card.id)).toEqual(['Moloch’s Ball and Chain', 'devastator']);
    });

    // Value: protects=the Plan can name Realm Klash pieces nothing plans; fails_when=a piece with no store item on sale
    // is missing, or a piece on sale (sold out or not started yet included), other gear or a character is listed; why_new=the list is new; seam=none;
    // no_claim=the wording (GearOrder)
    it('lists the Realm Klash pieces with no store item on sale', () => {
      const s = setup(
        [gear('Shadow Sash', F(2)), gear('Devastator', F(2)), gear('Bloody Tomahawk', F(2)), gear('Kori Blade', F(2)), card('Devastator x', F(2), { name: 'Devastator' })],
        [item('Shadow Sash'), item('Bloody Tomahawk', { endsAt: '2026-01-01T00:00' })],
      );
      // Tomahawk's item expired on Jan 1; Devastator has none. Listed in the buying order they go back to: Devastator
      // comes before the Tomahawk by default.
      const ctx = buildCtx(s);
      expect(gearWaiting(ctx, gearQueue(ctx, NOW)).map((c) => c.name)).toEqual(['Devastator', 'Bloody Tomahawk']);
      // A sold-out item only skips its piece for now, and one that hasn't started yet is saved for: neither is "not on sale".
      s.packs = [item('Shadow Sash', { maxPurchases: 1, purchased: 1 }), item('Bloody Tomahawk', { startsAt: '2026-02-01T00:00' })];
      const later = buildCtx(s);
      expect(gearWaiting(later, gearQueue(later, NOW)).map((c) => c.name)).toEqual(['Devastator']);
    });

    // Value: protects=the documented order for all ten pieces, the default five then the rest by name; fails_when=a name
    // changes in REALM_KLASH_GEAR or DEFAULT_GEAR_ORDER but not the other; why_new=nothing checked the two lists together;
    // seam=none; no_claim=new pieces (the list is final)
    it('orders all ten pieces: the default five, then the other five by name', () => {
      const names = ['Bloody Shokan Armor', 'Bloody Tomahawk', 'Bloody Voodoo Doll', 'Datusha, Bane of the Moroi', 'Devastator', "Blaze's Life Force", "Moloch's Ball and Chain", 'Shadow Sash', "Shang Tsung's Stone", "Sindel's Signet Ring"];
      const s = setup(names.map((n) => gear(n, F(2))), names.map((n) => item(n)));
      expect(gearQueue(buildCtx(s), NOW).map((g) => g.card.name)).toEqual([
        'Shadow Sash', "Moloch's Ball and Chain", 'Devastator', 'Datusha, Bane of the Moroi', 'Bloody Tomahawk',
        "Blaze's Life Force", 'Bloody Shokan Armor', 'Bloody Voodoo Doll', "Shang Tsung's Stone", "Sindel's Signet Ring",
      ]);
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
    // Value: protects=a pack keeps its typed odds when its Kasket rarity is gone; fails_when=the upgrade makes a Kasket
    // of a deleted rarity and wipes the odds for good; why_new=the upgrade runs once; seam=none; no_claim=renamed rarities
    const two = [pack('kd', drops, { name: 'Kollector’s Diamond Kasket' }), pack('kg', drops, { name: 'Kollector’s Gold Kasket' })];
    const shape = (rarities: RarityRule[]) => normalize({ ...v14, packs: two, rarities }).packs.map((p) => [p.id, p.kasket, p.drops.length]);
    expect(shape(v14.rarities.filter((r) => r.id !== 'diamond'))).toEqual([['kd', undefined, 1], ['kg', 'gold', 0]]);
    expect(shape(v14.rarities.map((r) => (r.id === 'diamond' ? { ...r, kind: 'kameo' as const } : r)))).toEqual([['kd', undefined, 1], ['kg', 'gold', 0]]);
  });

  // Value: protects=version 16 (No kards) loads older saves unchanged and keeps the flag; fails_when=the version isn't
  // bumped, so an older build pulls No kards data and plans kards on those cards or deletes a No kards piece at F3;
  // why_new=the bump has no migration step to test otherwise; seam=none; no_claim=sync's refusal (fromNewerApp, sync tests)
  it('moves saves to version 16 without changing them, and keeps No kards', () => {
    const v15 = { ...defaultState(), version: 15, cards: [card('a', F(2)), card('nk', F(5), { rarityId: 'epic', noKards: true })] } as unknown as AppState;
    const s = normalize(v15);
    expect([s.version, s.cards.map((c) => [c.id, c.noKards ?? null, c.goal ?? null])]).toEqual([defaultState().version, [['a', null, null], ['nk', true, null]]]);
    expect(normalize(s).cards).toEqual(s.cards);
    // Only an exact true counts: anything else from a hand-edited file is dropped rather than read as on.
    const odd = normalize({ ...v15, cards: [card('f', F(1), { noKards: false }), { ...card('s', F(1)), noKards: 'false' } as unknown as Card] });
    expect(odd.cards.map((c) => 'noKards' in c)).toEqual([false, false]);
  });

  // Value: protects=an import marking a pack both a store item and a Kasket keeps the store item if it has a drop, else
  // the Kasket; fails_when=the store item is dropped, so Realm Klash gear leaves the gear queue without a word, or a pack
  // with no drops becomes a store item of nothing; why_new=store now wins; seam=none; no_claim=the pack editor
  it('keeps an imported Kasket at one card per purchase with no drops, and treats a null or empty rarity as no Kasket', () => {
    const drops = [{ cardId: 'a', chance: 50 }];
    const s = normalize({
      ...defaultState(),
      cards: [card('a', 0)],
      packs: [
        pack('k', drops, { kasket: 'diamond', rolls: 5 }),
        { ...pack('n', drops), kasket: null },
        pack('e', drops, { kasket: '' }),
        pack('s', [{ cardId: 'a', chance: 100 }], { kasket: 'diamond', store: true }),
        pack('t', [], { kasket: 'diamond', store: true }),
      ],
    });
    expect(s.packs[0]).toEqual(pack('k', [], { kasket: 'diamond' }));
    expect(s.packs[1]).not.toHaveProperty('kasket');
    expect(s.packs[2]).not.toHaveProperty('kasket');
    expect(s.packs[1].drops).toEqual(drops);
    // Marked both a store item and a Kasket (only a hand-edited import): the store item wins when it has a drop, and
    // the Kasket when it has none, so the pack isn't a store item that drops nothing.
    expect(s.packs[3]).toEqual(pack('s', [{ cardId: 'a', chance: 100 }], { store: true }));
    expect(s.packs[4]).toEqual(pack('t', [], { kasket: 'diamond' }));
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

  // Value: protects=every copy of a No kards card after its first is valued at the threshold weight, and kards are never
  // planned or offered for it; fails_when=its copies past F3 drop to normal or kard-covered value, or the plan or Use
  // button spends kards on it; why_new=No kards is new; seam=none; no_claim=the box on Cards (CardsView.test.tsx)
  it('values every copy of a No kards card like those to the threshold, and plans and offers it no kards', () => {
    const s = setup([card('noob', F(5), { noKards: true }), card('mid', F(5))], [], (s) => (s.rarities[0].fusionUpKards = 7));
    const ctx = buildCtx(s);
    const c = (id: string) => ctx.cards.get(id)!;
    expect([copyPhase(ctx, c('noob')), copyPhase(ctx, c('noob'), 4), copyPhase(ctx, c('mid'), 3)]).toEqual(['noKards', 'noKards', 'kardCovered']);
    // Value: protects=a copy past a No kards card's max is worth nothing; fails_when=the No kards check moves above the
    // maxed check, so a pack's later rolls value copies he can't use; why_new=only copies short of max were checked;
    // seam=none; no_claim=none beyond protects
    expect(copyPhase(ctx, c('noob'), 5)).toBe('maxed');
    expect(ctx.kardPlan.get('diamond')).toEqual({ assignments: [{ cardId: 'mid', from: F(5), to: F(7), kards: 7 }], left: 0, cards: 1, cheapest: 3, realmKlash: 0, noKards: 1 });
    expect([kardStep(s, 'noob'), kardStep(s, 'mid')]).toEqual([null, 3]);
    // Unowned, the first copy is still an unlock.
    expect(copyPhase(buildCtx(setup([card('new', 0, { noKards: true })])), card('new', 0, { noKards: true }))).toBe('unlock');
    // A pack that can drop him is worth the threshold weight (1.5) over the same pack dropping an ordinary Diamond at F3.
    const t = setup([card('noob', F(3), { noKards: true }), card('plain', F(3))], [pack('a', [{ cardId: 'noob', chance: 50 }]), pack('b', [{ cardId: 'plain', chance: 50 }])]);
    const tc = buildCtx(t);
    expect(packEV(tc, t.packs[0]) / packEV(tc, t.packs[1])).toBeCloseTo(t.weights.belowThreshold);
    // Realm Klash gear is bought with Blood Rubies, so a No kards flag left on it changes nothing.
    const rk = setup([card('rk', F(5), { rarityId: 'epic', name: 'Shadow Sash', noKards: true })]);
    expect(copyPhase(buildCtx(rk), rk.cards[0])).toBe('normal');
  });

  // Value: protects=gear kards finish ordinary pieces around a No kards piece and never pick it as the next piece;
  // fails_when=the gear branch still spends kards on, or names, the No kards piece; why_new=the No kards test above uses a
  // Diamond character, not gear's finish-one-piece path; seam=none
  it('finishes gear with kards around a No kards piece', () => {
    const s = setup([card('nk', F(9), { rarityId: 'epic', noKards: true }), card('g', F(5), { rarityId: 'epic' })], [], (s) => {
      const epic = s.rarities.find((r) => r.id === 'epic')!;
      epic.goal = 'max';
      epic.fusionUpKards = 200;
    });
    const plan = buildCtx(s).kardPlan.get('epic')!;
    expect([plan.assignments.map((a) => a.cardId), plan.noKards, plan.next, plan.left]).toEqual([['g'], 1, undefined, 152]);
  });

  // Value: protects=a No kards piece is worked toward max and shows no copies to F3, so one at F5 isn't removed as done;
  // fails_when=it keeps the rarity's F3 goal and pruneDone deletes it; why_new=No kards is new; seam=none
  it("works a No kards piece toward max, so one past F3 isn't done there", () => {
    const s = setup([card('e', F(5), { rarityId: 'epic', noKards: true })]);
    const epic = s.rarities.find((r) => r.id === 'epic')!;
    expect([cardGoal(s.cards[0], epic), isMaxed(s.cards[0], epic), copiesToThreshold(card('x', F(1), { noKards: true }), rules().get('diamond')!)]).toEqual(['max', false, 0]);
    expect(pruneDone(s)).toEqual([]);
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

  // Value: protects=Use takes one step's kards and raises the card, but never on Realm Klash gear; fails_when=kardStep or
  // fuseWithKards works on a listed piece, or the wrong count leaves the Wallet; why_new=gear is listed by name;
  // seam=none; no_claim=the Use button itself (browser QA)
  it('uses Fusion Up Kards for one step: kards off the Wallet, the card up a level', () => {
    const s = setup([card('d', F(3)), card('low', F(2)), card('gear', F(5), { rarityId: 'epic', name: 'Devastator' })], [], (s) => {
      s.rarities[0].fusionUpKards = 3;
      const epic = s.rarities.find((r) => r.id === 'epic')!;
      epic.goal = 'max';
      epic.fusionUpKards = 30;
    });
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
    expect(kardStep(s, 'gear')).toBeNull(); // Realm Klash gear never takes kards, even with Epic kards in the Wallet
    s.cards[2].name = 'Kori Blade';
    expect(kardStep(s, 'gear')).toBe(5); // the same card off the list takes them
  });

  // Regression: /ship review of clock-and-gear-taps — a fuse tap after a sync used a different step than the button showed
  // Found by /ship on 2026-10-13
  // Value: protects=a fuse only goes ahead when the step still costs what the button showed; fails_when=the expected cost
  // is ignored, so a sync that moved the card on fuses a dearer step and the Undo label gives the wrong count; why_new=
  // review (Red Team); seam=none; no_claim=the buttons (PlanView and CardsView tests)
  it('fuses nothing when the step no longer costs what the button showed', () => {
    const s = setup([card('d', F(4))], [], (s) => (s.rarities[0].fusionUpKards = 5));
    expect(fuseWithKards(s, 'd', 1)).toBeNull(); // the button said 1 kard (F3 → F4); F4 → F5 costs 2 now
    expect([s.cards[0].fusion, s.rarities[0].fusionUpKards]).toEqual([F(4), 5]);
    expect(fuseWithKards(s, 'd', 2)).toBe(2);
  });

  // Regression: /review of stale-screens-and-schedule — a stale fuse tap fused a second level when the next step cost the same
  // Found by /review on 2026-10-13
  // Value: protects=a fuse goes ahead only from the level the button showed; fails_when=only the cost is checked, so a
  // sync that already made the step lets the tap make the next one, which costs the same, and spend the kards twice;
  // why_new=review (Red Team); seam=none; no_claim=the buttons (PlanView and CardsView tests)
  it('fuses nothing when a sync already made the step the button showed, even if the next costs the same', () => {
    const s = setup([card('d', F(5))], [], (s) => {
      s.rarities[0].fusionUpKards = 10;
      s.rarities[0].kardsPerLevel = [0, 0, 0, 2, 2, 2, 2, 2, 2, 2];
    });
    // The button was drawn at F4 (2 kards); a sync already fused it to F5, whose step also costs 2.
    expect(fuseWithKards(s, 'd', 2, F(4))).toBeNull();
    expect([s.cards[0].fusion, s.rarities[0].fusionUpKards]).toEqual([F(5), 10]);
    expect(fuseWithKards(s, 'd', 2, F(5))).toBe(2);
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

  // Value: protects=the plan's card count and Realm Klash count behind its notes; fails_when=listed gear counts as a card
  // kards could go to, or realmKlash is wrong; why_new=gear is listed by name; seam=none; no_claim=the note text (kardNotes)
  it('counts the cards kards could go to, so the plan can tell no card at F3 from too few kards', () => {
    const s = setup([card('low', F(2)), card('rk', F(5), { rarityId: 'epic', name: 'Shadow Sash' })], [], (s) => {
      s.rarities[0].fusionUpKards = 30;
      const epic = s.rarities.find((r) => r.id === 'epic')!;
      epic.goal = 'max';
      epic.fusionUpKards = 30;
    });
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [], left: 30, cards: 0, cheapest: null, realmKlash: 0 });
    expect(buildCtx(s).kardPlan.get('epic')).toEqual({ assignments: [], left: 30, cards: 0, cheapest: null, realmKlash: 1 }); // Realm Klash gear gets none
    // A card at F9 with 5 kards: there's a card, just not enough kards for its 10-kard step, which the plan names.
    s.cards = [card('near', F(9))];
    s.rarities[0].fusionUpKards = 5;
    expect(buildCtx(s).kardPlan.get('diamond')).toEqual({ assignments: [], left: 5, cards: 1, cheapest: 10, realmKlash: 0 });
  });

  // Value: protects=kards left saved on a rarity tracked to F3 (no kard box) are never planned or offered; fails_when=a card
  // with its own Goal of Max gets those hidden kards; why_new=a Goal of Max no longer means Realm Klash; seam=none;
  // no_claim=the Wallet box itself (PlanView)
  it("doesn't plan kards for a rarity tracked to F3, even for a card with its own Goal of Max", () => {
    const s = setup([card('kori', F(5), { rarityId: 'epic', goal: 'max' })], [], (s) => (s.rarities.find((r) => r.id === 'epic')!.fusionUpKards = 30));
    expect(buildCtx(s).kardPlan.has('epic')).toBe(false);
    expect(kardStep(s, 'kori')).toBeNull();
    s.rarities.find((r) => r.id === 'epic')!.goal = 'max';
    expect(kardStep(s, 'kori')).toBe(5); // F5 → F6
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
    // A character with a listed name isn't gear, but gear of any rarity is.
    expect(isRealmKlashGear(setup([]), card('x', F(5), { name: 'Devastator' }))).toBe(false);
    const rare = card('x', F(5), { rarityId: 'rare', name: 'Shadow Sash' });
    expect(isRealmKlashGear(setup([rare]), rare)).toBe(true);
    expect(targetLevel(rare, rules().get('rare')!)).toBe(F(10));
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
    // The excluded cards spelled the way the user might type them: word order and punctuation don't matter.
    const excluded = [card('x1', 0, { name: 'MK1 Noob Saibot' }), card('x2', 0, { name: 'Mileena, Assassin' })];
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
        // Havik's Patronage is the newest Epic gear, not Gold, so a Gold card of that name is still in the pool.
        card('x', F(2), { rarityId: 'gold', name: "Havik's Patronage" }),
      ],
      [kasket('gold')],
    );
    const pool = kasketPool(buildCtx(s), s.packs[0]);
    expect(pool.mode).toBe('unmaxed');
    expect(ids(pool.cards)).toEqual(['ascending', 'fusing', 'x']);
  });

  // Value: protects=the newest-cards list leaves out only a card of the right name and rarity; fails_when=a same-named
  // card of another rarity is left out of its Kasket, or the newest card isn't; why_new=the list now carries rarities;
  // seam=none; no_claim=the list's contents (patch-notes skill)
  it('leaves out the newest cards by name and rarity', () => {
    expect(isKasketExcluded({ name: "Havik's Patronage", rarityId: 'epic' })).toBe(true);
    expect(isKasketExcluded({ name: 'havik’s patronage', rarityId: 'epic' })).toBe(true);
    expect(isKasketExcluded({ name: "Havik's Patronage", rarityId: 'rare' })).toBe(false);
    expect(isKasketExcluded({ name: 'Noob Saibot MK1', rarityId: 'gold' })).toBe(false);
    // A rarity of your own (or Diamond rebuilt under a new id) can't be matched by id, so the name decides.
    expect(isKasketExcluded({ name: 'Noob Saibot MK1', rarityId: 'r-custom' })).toBe(true);
    expect(isKasketExcluded({ name: 'Klassic Noob Saibot', rarityId: 'r-custom' })).toBe(false);
    // The update before's newest cards are back in the pool.
    expect(isKasketExcluded({ name: 'Sub-Zero MK1', rarityId: 'diamond' })).toBe(false);
  });

  it("isn't valued once you own every piece of gear tracked only to the kard threshold, unless it's tracked to max", () => {
    const s = setup([card('e1', F(2), { rarityId: 'epic' }), card('e2', F(1), { rarityId: 'epic' })], [kasket('epic')]);
    expect(kasketPool(buildCtx(s), s.packs[0])).toMatchObject({ mode: 'none', cards: [] });
    expect(packEV(buildCtx(s), s.packs[0])).toBe(0);
    s.rarities.find((r) => r.id === 'epic')!.goal = 'max';
    expect(ids(kasketPool(buildCtx(s), s.packs[0]).cards)).toEqual(['e1', 'e2']);
  });

  it("isn't valued when only excluded cards are left, or its rarity is gone", () => {
    const s = setup([card('x1', F(4), { name: 'Noob Saibot MK1' }), card('x2', 0, { name: 'Mileena Assassin' })], [kasket('diamond'), kasket('gone', { id: 'k2' })]);
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

  // Value: protects=Kaskets never give a listed Realm Klash piece but can give other Blood Ruby gear; fails_when=the pool
  // includes Shadow Sash or drops gear only because a store item sells it; why_new=gear is listed by name; seam=none;
  // no_claim=the Kasket odds shown on Packs
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
    expect(line([card('e', F(2), { rarityId: 'epic' }), card('x', 0, { rarityId: 'epic', name: 'Khaotizator' })], 'epic')).toBe(
      "You own every Epic gear piece it gives, so this isn't valued",
    );
    expect(line([card('x', F(3), { name: 'Noob Saibot MK1' })], 'diamond')).toBe('Nothing left in this Kasket that MK Max tracks');
    expect(line([], 'gone')).toBe("This Kasket's rarity no longer exists, so it isn't valued");
  });

  it("offers every card of a Kasket's rarity in its pull search, the ones it can give first", () => {
    const cards = [card('new', 0), card('owned', F(2)), card('newest', 0, { name: 'Noob Saibot MK1' }), card('g', 0, { rarityId: 'gold' })];
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
    // Value: protects=the purchase-limit edges of "yours within n buys"; fails_when=<= becomes < (three buys left for
    // three cards drops the line) or a pool of one isn't 1; why_new=only the "too few buys" side was tested; seam=none;
    // no_claim=the wording (targetLine)
    const within = (packs: Pack[], cards = s.cards) => rankPacks(buildCtx({ ...s, cards, packs }), NOW).find((r) => r.pack.id === 'kd')?.targets[0]?.withinBuys;
    expect(within([{ ...s.packs[0], maxPurchases: 5, purchased: 2 }])).toBe(3); // exactly as many buys left as cards
    expect(within([{ ...s.packs[0], maxPurchases: 5, purchased: 3 }])).toBeUndefined(); // two buys can't promise three cards
    expect(within([{ ...s.packs[0], maxPurchases: 5, purchased: 5 }])).toBeUndefined(); // no buys left
    expect(within([s.packs[0]], [card('a', 0)])).toBe(1); // the last card you don't own
    // Regression: review of todo-followups — "every buy" followed "is a Kasket", not how the Kasket gives cards
    // Found by /review on 2026-10-12
    // Value: protects=a new-cards Kasket's cards are marked as coming once, an unmaxed Kasket's are not; fails_when=the
    // mark follows the Kasket flag, so a one-card unmaxed Kasket can't say "every buy"; why_new=review; seam=none;
    // no_claim=the rest of the wording (pack ranking lines)
    const sold = rankPacks(buildCtx({ ...s, cards: [card('a', 0)], packs: [{ ...s.packs[0], maxPurchases: 5, purchased: 5 }] }), NOW);
    expect(sold[0].targets[0].once).toBe(true); // the last new card, out of buys
    const gold = ranks.find((r) => r.pack.id === 'kg')!.targets[0];
    expect(gold.once).toBeUndefined();
    expect(targetLine(gold)).toBe('g: every buy'); // the one Gold card left short of max, on every buy
  });

  it("doesn't value a Kasket of a Kameo rarity", () => {
    const s = setup([card('k', 0, { rarityId: 'kameo-diamond' })], [kasket('kameo-diamond')]);
    expect(kasketPool(buildCtx(s), s.packs[0])).toMatchObject({ mode: 'none', cards: [] });
  });

  // Regression: /ship review of stale-screens-and-schedule — Save kept drops for cards a sync deleted
  // Found by /ship on 2026-10-14
  // Value: protects=saving a pack keeps only the drops whose cards still exist; fails_when=drops for cards a sync deleted
  // are saved, pointing at nothing (a store item for one is never cleared as done); why_new=review (adversarial);
  // seam=none; no_claim=the editor's own Save guard (PacksView.test.tsx)
  it('saves a pack without the drops for cards a sync deleted', () => {
    const s = setup([card('a', 0)]);
    savePack(s, pack('p', [{ cardId: 'a', chance: 40 }, { cardId: 'gone', chance: 60 }]), null, NOW);
    expect(s.packs[0].drops).toEqual([{ cardId: 'a', chance: 40 }]);
    // A store item left selling nothing isn't saved at all, nor one passed in with no item.
    expect(savePack(s, pack('item', [{ cardId: 'gone', chance: 100 }], { store: true }), null, NOW)).toBe(false);
    expect(savePack(s, pack('empty', [], { store: true }), null, NOW)).toBe(false);
    expect(s.packs.map((x) => x.id)).toEqual(['p']);
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

  // Generated by /ship review fixes on 2026-10-18
  // Value: protects=removing a rarity takes its Maxed record entries with it (they'd match nothing again), leaving
  // others; fails_when=entries are left pointing at a rarity that's gone; why_new=review (Red Team); seam=none; no_claim=the Undo label
  it('removes the Maxed entries of a removed rarity', () => {
    const s = setup([]);
    s.maxed = [{ name: 'Kori Blade', rarityId: 'epic' }, { name: 'd', rarityId: 'diamond' }];
    removeRarity(s, 'epic');
    expect(s.maxed).toEqual([{ name: 'd', rarityId: 'diamond' }]);
  });
});

describe('pack ranking lines', () => {
  // Value: protects=the Pack ranking's per-card wording; fails_when=a Kasket's "yours within n buys" or "yours next buy"
  // is lost or the average shows instead; why_new=the wording moved out of PlanView; seam=none; no_claim=which cards rank
  it('says the chance per buy, then within how many buys a Kasket card comes or the average', () => {
    const t = (withinBuys?: number, pAtLeastOne = 0.25, buysPerCopy = 4) => targetLine({ card: { name: 'Raiden' }, pAtLeastOne, buysPerCopy, withinBuys });
    expect(t()).toBe('Raiden: 25% per buy · about 4 buys per copy');
    expect(t(3, 1 / 3, 3)).toBe('Raiden: 33% per buy · yours within 3 buys');
    expect(t(1, 1, 1)).toBe('Raiden: yours next buy'); // a Kasket's last card, said once
  });

  // Value: protects=a card every buy gives reads "every buy", and an average of one reads "buy"; fails_when=a store item
  // says "100% per buy · about 1 buys per copy" again; why_new=found by /qa; seam=none; no_claim=which cards rank
  it('says "every buy" for a card a buy always gives, and "1 buy" in the singular', () => {
    const t = (pAtLeastOne: number, buysPerCopy: number, once = false) => targetLine({ card: { name: 'Shadow Sash' }, pAtLeastOne, buysPerCopy, ...(once && { once: true as const }) });
    expect(t(1, 1)).toBe('Shadow Sash: every buy');
    expect(t(0.99, 1.002)).toBe('Shadow Sash: 99% per buy · about 1 buy per copy');
    expect(t(0.5, 1.5)).toBe('Shadow Sash: 50% per buy · about 1.5 buys per copy');
    // Regression: review of todo-followups — "every buy" only for one sure copy per buy from a pack that isn't a Kasket
    // Found by /review on 2026-10-12
    // Value: protects=the ranking only promises what the pack gives; fails_when=a near-certain chance shows "100%", a
    // pack giving several copies hides them, or a sold-out Kasket says "every buy"; why_new=review; seam=none;
    // no_claim=which targets rankPacks marks once (kaskets test)
    expect(t(0.996, 1.004)).toBe('Shadow Sash: 99% per buy · about 1 buy per copy'); // under 100% never reads 100%
    expect(t(1, 1 / 3)).toBe('Shadow Sash: 100% per buy · about 0.33 buys per copy'); // three copies a buy
    expect(t(1, 1, true)).toBe('Shadow Sash: 100% per buy · about 1 buy per copy'); // a new-cards Kasket's last card, out of buys
    // Regression: review of todo-followups — a tiny but real chance read 0%
    // Found by /review on 2026-10-12
    expect(t(0.0004, 2500)).toBe('Shadow Sash: <0.1% per buy · about 2,500 buys per copy');
    expect(t(0.995, 1.005)).toBe('Shadow Sash: 99% per buy · about 1.01 buys per copy'); // shown as 1.01, so plural
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
        'no card but Realm Klash gear and a No kards piece',
        plan({ cards: 0, left: 60, realmKlash: 1, noKards: 1 }),
        epic,
        ['No Epic Equip card at F3 or higher that kards can go to yet, so these kards wait. Realm Klash gear gets none. Cards marked No kards get none.'],
      ],
      [
        'no card but a No kards card',
        plan({ cards: 0, left: 60, noKards: 2 }),
        epic,
        ['No Epic Equip card at F3 or higher that kards can go to yet, so these kards wait. Cards marked No kards get none.'],
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

  // Regression: /ship review of clock-and-gear-taps — a buy past the purchase limit was logged when the button was stale
  // Found by /ship on 2026-10-13
  // Value: protects=a buy at the purchase limit logs nothing, and a pull-step step that clamps reports no change;
  // fails_when=only the button's disabled stops a buy past the limit, or stepCard can't tell a clamp from a change;
  // why_new=review (Red Team); seam=none; no_claim=the buttons (PacksView test)
  it('logs no buy past the purchase limit, and stepCard says when it changed nothing', () => {
    const s = setup([card('a', F(2))], [pack('p', [{ cardId: 'a', chance: 50 }], { maxPurchases: 1 })], (s) => (s.currencies[0].balance = 500));
    expect(recordPurchase(s, 'p', 1)).toBe(true);
    expect(recordPurchase(s, 'p', 1)).toBe(false);
    expect([s.packs[0].purchased, s.currencies[0].balance]).toEqual([1, 400]);
    expect(stepCard(s, 'a', 1)).toBe(true);
    s.cards[0].fusion = 0;
    expect(stepCard(s, 'a', -1)).toBe(false); // already 0
    expect(stepCard(s, 'gone', 1)).toBe(false);
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
  // Value: protects=Realm Klash gear carries a stored goal of max, which older copies of the app read, and survives a
  // half-typed rename; fails_when=pruneDone leaves the goal unset (an old copy deletes the piece at F3) or deletes it when
  // its name leaves the list mid-rename; why_new=the goal is no longer set by hand; seam=none; no_claim=the old app itself
  it('saves a goal of max on Realm Klash gear, so a rename or an older copy of the app keeps it', () => {
    const s = setup([card('rk', F(5), { rarityId: 'epic', name: 'Shadow Sash', goal: 'threshold' }), card('kori', F(2), { rarityId: 'epic' }), card('dev', F(2), { name: 'Devastator' })]);
    expect(pruneDone(s)).toEqual([]);
    expect(s.cards.map((c) => c.goal)).toEqual(['max', undefined, undefined]);
    s.cards[0].name = 'Shadow Sas'; // halfway through retyping the name
    expect(pruneDone(s)).toEqual([]);
    expect(s.cards[0].goal).toBe('max');
  });

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

  // Regression: /ship review of clock-and-gear-taps — the schedule's season-end move ran again on a copy that already had it
  // Found by /ship on 2026-10-13
  // Value: protects=moveSeasonEnd reports when the season already ends there and leaves the save as it was; fails_when=it
  // moves (and stamps) again after a pull already brought the move in; why_new=review (Red Team); seam=none;
  // no_claim=the App effect that calls it
  it('moves nothing when the season already ends there', () => {
    const s = setup([], [pack('now', [], { season: true, endsAt: '2026-01-12T20:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-12T20:00'));
    const before = structuredClone(s);
    expect(moveSeasonEnd(s, '2026-01-12T20:00', NOW)).toBe(false);
    expect(s).toEqual(before);
    expect(moveSeasonEnd(s, '2026-01-13T20:00', NOW)).toBe(true);
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

  // Regression: /review of stale-screens-and-schedule — a season stretched by exactly 2 weeks left its items expired
  // Found by /review on 2026-10-13
  // Value: protects=when the schedule's new end is the saved end rolled forward 2 weeks, items still ending on the saved
  // week end move too; fails_when=matching the rolled-forward end counts as nothing to move; why_new=review (Red Team,
  // adversarial, maintainability); seam=none; no_claim=the App effect that calls it
  it('moves items still on the saved end when the schedule extended the season by exactly 2 weeks', () => {
    const s = setup([], [
      pack('this', [], { season: true, endsAt: '2026-01-10T11:00' }),
      pack('before', [], { season: true, endsAt: '2026-01-03T11:00' }),
      // The next season, already dated by the schedule as one week long: the changeover at Jan 24 hasn't moved.
      pack('next', [], { season: true, startsAt: '2026-01-24T11:00', endsAt: '2026-01-31T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    // Rolled forward 2 weeks, the saved Jan 10 end is Jan 24: the same date the schedule now gives.
    expect(moveSeasonEnd(s, '2026-01-24T11:00', NOW, ['2026-01-10T11:00'])).toBe(true);
    expect(s.packs.map((p) => p.endsAt)).toEqual(['2026-01-24T11:00', '2026-01-03T11:00', '2026-01-31T11:00']);
    expect(s.realmKlashSeasonEnd).toBe('2026-01-24T11:00');
    // Once moved, the same schedule has nothing left to move.
    expect(moveSeasonEnd(s, '2026-01-24T11:00', NOW, ['2026-01-10T11:00'])).toBe(false);
  });

  // Regression: /ship review of stale-screens-and-schedule — a 2-week stretch with nothing to move still saved
  // Found by /ship on 2026-10-14
  // Value: protects=a 2-week stretch with no item on the passed week end saves nothing, leaving the saved end as it was;
  // fails_when=the season end is rewritten anyway, so every device saves and two opening together ask which copy to keep;
  // why_new=review (adversarial); seam=none; no_claim=the App effect that calls it
  it('saves nothing for a 2-week stretch when no item ends on the passed week end', () => {
    const s = setup([], [
      // Next season's item, already dated by the schedule: it doesn't move either way.
      pack('next', [], { season: true, startsAt: '2026-01-24T11:00', endsAt: '2026-01-31T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    const before = structuredClone(s);
    expect(moveSeasonEnd(s, '2026-01-24T11:00', NOW, ['2026-01-10T11:00'])).toBe(false);
    expect(s).toEqual(before);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=when the schedule stretches the season by exactly 2 weeks, an item on sale since the saved week end
  // keeps its start and ends with the season; fails_when=a start on a stretched week end counts as entered ahead, so an
  // item already in the store moves to the new end and drops out of the plan; why_new=review (adversarial): store items
  // can't be entered ahead; seam=none; no_claim=the App effect that calls it
  it('keeps the start of an item on sale since the saved end when the schedule extended the season by exactly 2 weeks', () => {
    const s = setup([], [
      // In the store since the saved week end (the shop lists items from their real start), ending on the 2-week guess.
      pack('onSale', [], { season: true, startsAt: '2026-01-10T11:00', endsAt: seasonEnd('2026-01-10T11:00', new Date('2026-01-10T11:00'))! }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    expect(s.packs[0].endsAt).toBe('2026-01-24T11:00');
    // It already ends with the season, so there's nothing to move or save.
    expect(moveSeasonEnd(s, '2026-01-24T11:00', NOW, ['2026-01-10T11:00'])).toBe(false);
    expect([s.packs[0].startsAt, s.packs[0].endsAt]).toEqual(['2026-01-10T11:00', '2026-01-24T11:00']);
  });

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=a 2-week stretch leaves an item starting after the unmoved end (next season's mid-season item) on its
  // own dates; fails_when=only items starting exactly at the end are left alone, so a short item gets the 2-week guess;
  // why_new=the stretch tests above have items starting at the end, none after it; seam=none; no_claim=the App effect
  it("leaves next season's mid-season item alone when the schedule stretched the season by exactly 2 weeks", () => {
    const s = setup([], [
      pack('this', [], { season: true, endsAt: '2026-01-10T11:00' }),
      // The schedule's 3-day item in the second week of next season.
      pack('next', [], { season: true, startsAt: '2026-01-31T11:00', endsAt: '2026-02-03T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    expect(moveSeasonEnd(s, '2026-01-24T11:00', NOW, ['2026-01-10T11:00'])).toBe(true);
    expect(s.packs.map((p) => [p.startsAt ?? null, p.endsAt])).toEqual([
      [null, '2026-01-24T11:00'],
      ['2026-01-31T11:00', '2026-02-03T11:00'],
    ]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=a schedule stretching the season a week after its mid-season changeover passed moves items still on
  // it, though the saved end is the season's start; fails_when=only the saved end itself is checked as a week end, so
  // the item stays expired and next season's item starts at the old changeover; why_new=the stretch tests above all
  // save the week end itself; seam=none; no_claim=the App effect that calls it
  it('moves items on an earlier week end the saved end rolled through when the schedule extends the season a week', () => {
    // Saved at the season's start (the app only rewrites it when the date changes); the schedule then stretched the
    // season ending Jan 17 to Jan 24, after Jan 17 had passed.
    const now = new Date('2026-01-18T12:00:00');
    const s = setup([], [
      pack('this', [], { season: true, endsAt: '2026-01-17T11:00' }),
      // On sale since the old changeover, added after it with the end the app then had for the season.
      pack('onSale', [], { season: true, startsAt: '2026-01-17T11:00', endsAt: '2026-01-31T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    expect(moveSeasonEnd(s, '2026-01-24T11:00', now, ['2026-01-17T11:00', '2026-01-10T11:00'])).toBe(true);
    // Both end with the season; the item on sale keeps its start.
    expect(s.packs.map((p) => [p.startsAt ?? null, p.endsAt])).toEqual([
      [null, '2026-01-24T11:00'],
      ['2026-01-17T11:00', '2026-01-24T11:00'],
    ]);
    expect(s.realmKlashSeasonEnd).toBe('2026-01-24T11:00');
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=a 2-week stretch whose new end is the saved season start rolled forward still moves items on the
  // earlier week end it rolled through; fails_when=the rolled-forward match counts as already there and nothing moves;
  // why_new=the exact-2-week test above saves the week end itself; seam=none; no_claim=the App effect that calls it
  it('moves items on an earlier week end the saved end rolled through when the schedule extends the season 2 weeks', () => {
    const now = new Date('2026-01-18T12:00:00');
    const s = setup([], [
      pack('this', [], { season: true, endsAt: '2026-01-17T11:00' }),
      // On sale since the old changeover: it already ends with the season.
      pack('onSale', [], { season: true, startsAt: '2026-01-17T11:00', endsAt: '2026-01-31T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    // Rolled forward, the saved Jan 3 start is Jan 31: the same date the schedule now gives.
    expect(seasonEnd(s.realmKlashSeasonEnd, now)).toBe('2026-01-31T11:00');
    expect(moveSeasonEnd(s, '2026-01-31T11:00', now, ['2026-01-17T11:00', '2026-01-10T11:00'])).toBe(true);
    expect(s.packs.map((p) => [p.startsAt ?? null, p.endsAt])).toEqual([
      [null, '2026-01-31T11:00'],
      ['2026-01-17T11:00', '2026-01-31T11:00'],
    ]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=when the end moves and the season was stretched, an item already starting at the new end keeps its
  // own dates while one on sale since the stretched week end keeps its start and ends with the season; fails_when=the start-at-to check runs only when
  // the end stays, so the next season's item gets the 2-week guess; why_new=the stretch tests above have no item at `to`;
  // seam=none; no_claim=the App effect that calls it
  it('keeps the dates of an item already starting at the new end when a stretched season moves', () => {
    const now = new Date('2026-01-18T12:00:00');
    const s = setup([], [
      pack('onSale', [], { season: true, startsAt: '2026-01-17T11:00', endsAt: '2026-01-31T11:00' }),
      // Already dated by the schedule: the season after starts at the new end and runs three weeks.
      pack('listed', [], { season: true, startsAt: '2026-01-24T11:00', endsAt: '2026-02-14T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    // Rolled forward, the saved end is Jan 31, so the end moves (to Jan 24) and Jan 17 is a stretched week end.
    expect(seasonEnd(s.realmKlashSeasonEnd, now)).toBe('2026-01-31T11:00');
    expect(moveSeasonEnd(s, '2026-01-24T11:00', now, ['2026-01-17T11:00', '2026-01-10T11:00'])).toBe(true);
    expect(s.packs.map((p) => [p.startsAt, p.endsAt])).toEqual([
      ['2026-01-17T11:00', '2026-01-24T11:00'],
      ['2026-01-24T11:00', '2026-02-14T11:00'],
    ]);
  });

  // Generated by /ship test coverage audit on 2026-10-14
  // Value: protects=an item on sale since mid-week after a stretched week end keeps its start, and its own short end
  // unless that was the season's; fails_when=a start after a stretched week end counts as entered ahead, so a 2-day item
  // gets the 2-week guess; why_new=the stretch tests above start items on a week end, never between; seam=none;
  // no_claim=the App effect that calls it
  it('keeps the dates of an item on sale since mid-week after a stretched week end, ending only the season-long one with it', () => {
    const now = new Date('2026-01-18T12:00:00');
    const s = setup([], [
      // The schedule's 2-day item, in the store since the day after the passed week end.
      pack('flash', [], { season: true, startsAt: '2026-01-19T11:00', endsAt: '2026-01-21T11:00' }),
      // Added the same day with the end the app then had for the season (the saved end rolled forward).
      pack('onSale', [], { season: true, startsAt: '2026-01-19T11:00', endsAt: '2026-01-31T11:00' }),
    ], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    expect(moveSeasonEnd(s, '2026-01-24T11:00', now, ['2026-01-17T11:00', '2026-01-10T11:00'])).toBe(true);
    expect(s.packs.map((p) => [p.startsAt, p.endsAt])).toEqual([
      ['2026-01-19T11:00', '2026-01-21T11:00'],
      ['2026-01-19T11:00', '2026-01-24T11:00'],
    ]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=an item starting at the new end whose end is the old current end (written in by packEndOnSave)
  // takes the 2-week guess from its start; fails_when=it keeps the old end or is moved to its own start and expires
  // unseen; why_new=the test above gives the item an end no changeover has; seam=none; no_claim=the App effect that calls it
  it('gives an item starting at the new end the 2-week guess when it ends on the old rolled-forward end', () => {
    const now = new Date('2026-01-18T12:00:00');
    // Entered ahead against the old current end (Jan 31, the saved end rolled forward), so it was given that end.
    const s = setup([], [pack('listed', [], { season: true, startsAt: '2026-01-24T11:00', endsAt: '2026-01-31T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    expect(moveSeasonEnd(s, '2026-01-24T11:00', now, ['2026-01-17T11:00', '2026-01-10T11:00'])).toBe(true);
    expect([s.packs[0].startsAt, s.packs[0].endsAt]).toEqual(['2026-01-24T11:00', seasonEnd('2026-01-24T11:00', new Date('2026-01-24T11:00'))]);
    expect(s.packs[0].endsAt).toBe('2026-02-07T11:00');
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=an ordinary season whose mid-season week end is listed moves nothing when the schedule gives its
  // usual end; fails_when=every listed week end counts, not just changeovers the saved end rolled through, so a normal
  // season keeps moving; why_new=the stretch tests above all have a stretch; seam=none; no_claim=the App effect
  it('moves nothing in a normal season whose mid-season week end the schedule lists', () => {
    const s = setup([], [pack('this', [], { season: true, endsAt: '2026-01-17T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-03T11:00'));
    const before = structuredClone(s);
    expect(moveSeasonEnd(s, '2026-01-17T11:00', new Date('2026-01-12T12:00:00'), ['2026-01-10T11:00'])).toBe(false);
    expect(s).toEqual(before);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=stretchedWeekEnds lists the passed changeovers the schedule calls earlier week ends, latest first,
  // and none for a future or missing end; fails_when=it checks only the saved end, includes a future one, or loses the
  // order; why_new=the helper is new; seam=none; no_claim=the moves themselves (tests above)
  it('lists the changeovers the saved end rolled through that the schedule calls earlier week ends', () => {
    const weekEnds = ['2026-01-17T11:00', '2026-01-10T11:00'];
    const at = new Date('2026-01-18T12:00:00');
    expect([
      stretchedWeekEnds('2026-01-10T11:00', NOW, ['2026-01-10T11:00']), // the saved end itself, just passed
      stretchedWeekEnds('2026-01-03T11:00', at, weekEnds), // a season back: rolled through Jan 17
      stretchedWeekEnds('2025-12-20T11:00', at, ['2026-01-03T11:00', '2026-01-17T11:00']), // two of them, latest first
      stretchedWeekEnds('2026-01-17T11:00', NOW, weekEnds), // still in the future
      stretchedWeekEnds('2026-01-03T11:00', at, []),
      stretchedWeekEnds('2026-01-03T11:00', at, undefined),
      stretchedWeekEnds(null, at, weekEnds),
    ]).toEqual([['2026-01-10T11:00'], ['2026-01-17T11:00'], ['2026-01-17T11:00', '2026-01-03T11:00'], [], [], [], []]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=stretchedWeekEnds matches no week end an hour or two off a rolled changeover with no clock change
  // between; fails_when=any week end within an hour counts, so a hand-typed end moves the season before; why_new=the
  // rows above all match exactly; seam=none; no_claim=a real clock change (the London test below)
  it("doesn't match a week end an hour off a rolled changeover with no clock change between", () => {
    const at = new Date('2026-01-18T12:00:00');
    expect([
      stretchedWeekEnds('2026-01-03T11:00', at, ['2026-01-17T12:00', '2026-01-10T11:00']), // an hour later
      stretchedWeekEnds('2026-01-03T11:00', at, ['2026-01-17T10:00', '2026-01-10T11:00']), // an hour earlier
      stretchedWeekEnds('2026-01-03T11:00', at, ['2026-01-17T13:00', '2026-01-10T11:00']), // two hours: another time
    ]).toEqual([[], [], []]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=across a real clock change (London, March and October) a rolled changeover matches the schedule's
  // week end an hour off and returns both spellings; fails_when=only an exact instant counts, so items stay expired;
  // why_new=the rows above have no clock change; seam=process.env.TZ set to Europe/London for this test;
  // no_claim=other zones, a clock change that isn't an hour
  it('matches a week end an hour off a rolled changeover across a clock change, returning both spellings', () => {
    const before = process.env.TZ;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = 'Europe/London';
    try {
      // Saved in winter time; rolled 2 weeks it keeps 11:00 local, now in summer time, while the real changeover is
      // still 11:00 UTC, which the schedule spells 12:00. October is the other way round.
      expect(new Date('2026-04-04T11:00').getTime() - new Date('2026-03-21T11:00').getTime()).toBe((14 * 24 - 1) * 3600_000);
      expect([
        stretchedWeekEnds('2026-03-21T11:00', new Date('2026-04-05T12:00'), ['2026-04-04T12:00']),
        stretchedWeekEnds('2026-10-17T11:00', new Date('2026-11-01T12:00'), ['2026-10-31T10:00']),
      ]).toEqual([['2026-04-04T12:00', '2026-04-04T11:00'], ['2026-10-31T11:00', '2026-10-31T10:00']]);
    } finally {
      // Setting TZ back to the zone in use before resets the clock; then unset it if it wasn't set.
      process.env.TZ = before ?? zone;
      if (before === undefined) delete process.env.TZ;
    }
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=stretchedWeekEnds rolls a saved end years back onto the right 2-week changeover, and a mistyped
  // future year finds none; fails_when=the skip ahead lands off the saved end's grid or past a week end it should match;
  // why_new=the rows above save ends a season or two back; seam=none; no_claim=how long the old step-by-step loop took
  it('finds the right changeover from a saved end years back, and none from a mistyped future year', () => {
    const at = new Date('2026-01-18T12:00:00');
    const weekEnds = ['2026-01-17T11:00', '2026-01-10T11:00'];
    // Jan 10 2026 is 157 seasons (2,198 days) after Jan 4 2020; Jan 17 is half a season off that grid.
    expect([stretchedWeekEnds('2020-01-04T11:00', at, weekEnds), stretchedWeekEnds('2062-01-10T11:00', at, weekEnds)]).toEqual([['2026-01-10T11:00'], []]);
  });

  it("leaves the last season's items alone when its end was set a little after the real changeover", () => {
    // Ended early tapped at 11:00; the schedule then lists a new season that started at 10:00.
    const s = setup([], [pack('last', [], { season: true, endsAt: '2026-01-10T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    moveSeasonEnd(s, '2026-01-17T10:00', NOW, []);
    expect(s.packs[0].endsAt).toBe('2026-01-10T11:00');
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=a hand-set end an hour after a week end the schedule lists, with no clock change between, moves
  // nothing from the season before; fails_when=any week end within an hour counts as the saved end; why_new=the test
  // above lists no week ends; seam=none; no_claim=a real clock change (the London stretchedWeekEnds test)
  it("leaves the last season's items alone when the schedule lists a week end an hour before the end set by hand", () => {
    // Ended early tapped at 11:00; the schedule lists 10:00 that day as a week end.
    const s = setup([], [pack('last', [], { season: true, endsAt: '2026-01-10T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    expect(moveSeasonEnd(s, '2026-01-17T10:00', NOW, ['2026-01-10T10:00'])).toBe(true);
    expect([s.packs[0].endsAt, s.realmKlashSeasonEnd]).toEqual(['2026-01-10T11:00', '2026-01-17T10:00']);
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

  it('keeps the start of an item on sale since the saved end when the schedule extends the season after it passed', () => {
    // Store items can't be entered ahead, so one starting on the passed week end has been on sale since then.
    const s = setup([], [pack('onSale', [], { season: true, startsAt: '2026-01-10T11:00', endsAt: '2026-01-24T11:00' })], (s) => (s.realmKlashSeasonEnd = '2026-01-10T11:00'));
    moveSeasonEnd(s, '2026-01-17T11:00', NOW, ['2026-01-10T11:00']);
    expect([s.packs[0].startsAt, s.packs[0].endsAt]).toEqual(['2026-01-10T11:00', '2026-01-17T11:00']);
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

describe('moveRarity', () => {
  // Generated on 2026-10-20 (rarity order in Settings)
  // Value: protects=a rarity moves one place past the neighbour the screen showed, in a new array, and a stale move (the
  // neighbour isn't next to it that way round any more, or either is gone) changes nothing; fails_when=moves go by index
  // alone, so a tap after a sync shifts the wrong rarity; why_new=rarities couldn't be reordered before; seam=none;
  // no_claim=the Settings buttons (SettingsView.test.tsx)
  it('moves a rarity past its shown neighbour, and refuses a move a sync made stale', () => {
    const s = defaultState();
    const ids = () => s.rarities.map((r) => r.id);
    const before = s.rarities;
    expect(moveRarity(s, 'kameo-diamond', 'uncommon', -1)).toBe(true);
    expect([ids(), s.rarities === before]).toEqual([['diamond', 'gold', 'epic', 'rare', 'kameo-diamond', 'uncommon', 'kameo-gold'], false]);
    expect(moveRarity(s, 'diamond', 'gold', 1)).toBe(true);
    expect(ids().slice(0, 2)).toEqual(['gold', 'diamond']);
    // Stale: gold is no longer below diamond, the first can't go up, and a gone rarity can't move.
    const after = ids();
    expect([moveRarity(s, 'diamond', 'gold', 1), moveRarity(s, 'gold', 'diamond', -1), moveRarity(s, 'nope', 'gold', 1), ids()]).toEqual([false, false, false, after]);
    // Extended by /ship review fixes on 2026-10-20: the shown neighbour is the one a sync removed, so Diamond doesn't
    // jump past Epic Equip, a rarity the screen never showed below it.
    const synced = defaultState();
    synced.rarities = synced.rarities.filter((r) => r.id !== 'gold');
    const shown = synced.rarities.map((r) => r.id);
    expect([moveRarity(synced, 'diamond', 'gold', 1), synced.rarities.map((r) => r.id)]).toEqual([false, shown]);
  });

  // Generated by /ship review fixes on 2026-10-20 (the docs promise a tap is refused only when its pair moved)
  // Value: protects=a sync that moved some other rarity doesn't block a tap whose rarity and shown neighbour are still
  // side by side; fails_when=the check compares the whole order or the shown position, so any sync refuses the tap;
  // why_new=every stale case above moves the tapped pair itself; seam=none; no_claim=the Settings buttons
  it('still moves a rarity when a sync only moved another one', () => {
    const s = defaultState();
    // A sync puts Gold Kameo first, so Diamond and Gold both shift down one place but stay side by side.
    s.rarities = [s.rarities.find((r) => r.id === 'kameo-gold')!, ...s.rarities.filter((r) => r.id !== 'kameo-gold')];
    expect([moveRarity(s, 'diamond', 'gold', 1), s.rarities.slice(0, 3).map((r) => r.id)]).toEqual([true, ['kameo-gold', 'gold', 'diamond']]);
  });
});

describe('towerSpellings', () => {
  // Generated on 2026-10-22 (/ship review, Tower dropdown)
  // Value: protects=the Cards Tower list and Tower gear headings spell a tower the same way: once per tower whatever the
  // capitals or spaces, as the first tower gear card names it, and only from tower gear; fails_when=the two screens keep
  // their own spelling rules again, or another source's note is read as a tower; why_new=the rule moved here from two
  // copies; seam=none; no_claim=none beyond protects
  it('spells each tower once, as the first tower gear card naming it has it', () => {
    const card = (name: string, sourceNote: string, source: Card['source'] = 'tower'): Card => ({ id: name, name, rarityId: 'epic', fusion: 1, guest: false, source, sourceNote });
    // Extended on 2026-10-22 (/ship review, maintainability): a card under a rarity a sync removed is hidden, so it doesn't
    // spell a tower even when it comes first; fails_when=a caller's copy of that rule is missed and a hidden card decides
    // the spelling the Tower list, Add card and Paste a list save.
    const hidden: Card = { ...card('Ghost Blade', 'LIN KUEI TOWER'), rarityId: 'gone' };
    const cards = [hidden, card('Kori Blade', ' Lin Kuei Tower'), card('Frost Fan', 'lin kuei tower '), card('Ryu Kunai', 'Shirai Ryu Tower'), card('Krypt Axe', 'Krypt', 'krypt'), card('Blank', '  ')];
    expect([...towerSpellings({ cards, rarities: defaultState().rarities })]).toEqual([
      ['lin kuei tower', 'Lin Kuei Tower'],
      ['shirai ryu tower', 'Shirai Ryu Tower'],
    ]);
  });
});

describe('respellTower', () => {
  // Generated on 2026-10-22 (/ship review, Tower dropdown)
  // Value: protects=a typed tower name becomes its spelling on every tower gear card naming it another way, however mixed
  // (typing the spelling already shown still fixes the others), and a tower no card names changes nothing; fails_when=a
  // retyped spelling only changes some cards, other sources' notes change, or a card already spelled that way (even with a
  // space at the end) is counted;
  // why_new=new helper; seam=none; no_claim=none beyond protects
  it('spells a tower as typed on every card naming it another way', () => {
    const card = (name: string, sourceNote: string, source: Card['source'] = 'tower'): Card => ({ id: name, name, rarityId: 'epic', fusion: 1, guest: false, source, sourceNote });
    const cards = () => [card('Kori Blade', 'lin kuei tower'), card('Frost Fan', 'LIN KUEI TOWER '), card('Ryu Kunai', 'Shirai Ryu Tower'), card('Krypt Axe', 'lin kuei tower', 'krypt'), card('Fire Fan', 'Lin Kuei Tower'), card('Wind Fan', 'Lin Kuei Tower ')];
    const rarities = defaultState().rarities;
    const fixed = cards();
    const shown = cards();
    const unknown = cards();
    expect([respellTower({ cards: fixed, rarities }, 'Lin Kuei Tower'), respellTower({ cards: shown, rarities }, 'lin kuei tower'), respellTower({ cards: unknown, rarities }, 'Wind Tower')]).toEqual([2, 3, 0]);
    expect([fixed.map((c) => c.sourceNote), shown.map((c) => c.sourceNote), unknown]).toEqual([
      ['Lin Kuei Tower', 'Lin Kuei Tower', 'Shirai Ryu Tower', 'lin kuei tower', 'Lin Kuei Tower', 'Lin Kuei Tower '],
      ['lin kuei tower', 'lin kuei tower', 'Shirai Ryu Tower', 'lin kuei tower', 'lin kuei tower', 'lin kuei tower'],
      cards(),
    ]);

    // Extended on 2026-10-22 (/ship review, maintainability): the card the name was typed on (skip) and a card under a
    // rarity a sync removed are left as they are; fails_when=the hidden-card rule or the typed card's skip is lost when a
    // caller stops filtering for itself.
    const typedOn = card('Kori Blade', 'LIN KUEI TOWER');
    const hidden: Card = { ...card('Ghost Blade', 'lin kuei tower'), rarityId: 'gone' };
    const mixed = [typedOn, hidden, card('Frost Fan', 'lin kuei tower')];
    expect([respellTower({ cards: mixed, rarities }, 'Lin Kuei Tower', typedOn), mixed.map((c) => c.sourceNote)]).toEqual([1, ['LIN KUEI TOWER', 'lin kuei tower', 'Lin Kuei Tower']]);
  });
});
