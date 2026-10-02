import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import { challengeFor, currencyFor, packFromShop, scheduledSeasonEnd, shopSuggestions, titleCase, packName, fixPackNames, type EventSchedule } from './events';
import { toLocalInput } from './engine';

const NOW = new Date('2026-09-28T17:00:00Z');
const local = (iso: string) => toLocalInput(new Date(iso));
const events: EventSchedule = {
  fetchedAt: '2026-09-28T00:00:00Z',
  capturedAt: '2026-09-24T00:00:00Z',
  packs: [
    { name: 'MK11 FROST SUMMON PACK', start: '2026-09-16T16:00:00Z', end: '2026-10-07T16:00:00Z', cost: 15, currency: 'Dragon Krystals', limit: null, image: null },
    { name: 'BLOODFIRE KAMEO SUMMON PACK', start: '2025-03-25T16:00:00Z', end: null, cost: 400, currency: 'Blood Ruby', limit: null, image: null },
    { name: 'MARTIAL ARTIST KOMBAT PACK', start: '2026-09-23T16:00:00Z', end: '2026-09-30T16:00:00Z', cost: 400, currency: 'Soul', limit: 20, image: null },
    { name: 'OLD PACK', start: '2026-09-01T16:00:00Z', end: '2026-09-20T16:00:00Z', cost: 1, currency: 'Soul', limit: null, image: null },
  ],
  challenges: [
    { name: "D'VORAH Venomous", start: '2026-09-23T16:00:00Z', end: '2026-09-30T16:00:00Z' },
    { name: 'TRIBORG Sub-Zero (LK-52O)', start: '2026-09-30T16:00:00Z', end: '2026-10-07T16:00:00Z' },
  ],
  seasons: [
    { name: 'Circle of Shadow 2', start: '2026-09-23T16:00:00Z', end: '2026-09-30T16:00:00Z' },
    { name: 'Kold', start: '2026-09-30T16:00:00Z', end: '2026-10-07T16:00:00Z' },
    { name: 'Kold', start: '2026-10-07T16:00:00Z', end: '2026-10-14T16:00:00Z' },
  ],
};

describe('event schedule', () => {
  it('maps site currencies and pack names to the app', () => {
    const cur = defaultState().currencies;
    expect(['Dragon Krystals', 'Blood Ruby', 'Soul'].map((c) => currencyFor(c, cur))).toEqual(['dragon-krystals', 'blood-rubies', 'souls']);
    expect(titleCase("MK11 FROST SUMMON PACK")).toBe('MK11 Frost Summon Pack');
    expect(titleCase("BEGINNER'S SUMMON PACK")).toBe("Beginner's Summon Pack");
    expect(titleCase('KOLLECTOR’S DIAMOND KASKET')).toBe('Kollector’s Diamond Kasket');
    const pack = (name: string, currency = 'Blood Ruby') => packName({ name, currency });
    expect(pack('BLOODFIRE KAMEO SUMMON PACK')).toBe('Blood & Fire Kameo Pack'); // the site's spelling
    expect(pack('POWERPLAY KAMEO SUMMON PACK')).toBe('Power Play Kameo Pack');
    expect(pack('STUNNING KAMEO SUMMON PACK')).toBe('Stunning Kameo Pack');
    expect(pack('MK1 SUB-ZERO KAMEO SUMMON PACK', 'Dragon Krystals')).toBe('MK1 Sub-Zero Kameo Summon Pack');
    const saved = (name: string, currencyId: string) => ({ ...packFromShop(events.packs[0], defaultState(), 'x'), name, currencyId });
    expect(fixPackNames([saved('Bloodfire Kameo Summon Pack', 'blood-rubies'), saved('Stunning Kameo Summon Pack', 'blood-rubies'), saved('Kameo Pack', 'dragon-krystals')]).map((p) => p.name)).toEqual([
      'Blood & Fire Kameo Pack',
      'Stunning Kameo Pack',
      'Kameo Summon Pack',
    ]);
  });

  it('suggests shop packs that are on or coming up, minus ones already added or not needed', () => {
    const s = defaultState();
    s.packs = [{ ...packFromShop(events.packs[0], s, 'x') }];
    s.dismissedShopPacks = ['MARTIAL ARTIST KOMBAT PACK'];
    expect(shopSuggestions(events, s, NOW).map((p) => p.name)).toEqual(['BLOODFIRE KAMEO SUMMON PACK']);
  });

  it('fills in a pack from the shop, leaving permanent Blood Ruby packs out of the season', () => {
    const s = defaultState();
    expect(packFromShop(events.packs[2], s, 'a')).toMatchObject({ name: 'Martial Artist Kombat Pack', currencyId: 'souls', cost: 400, maxPurchases: 20, endsAt: local('2026-09-30T16:00:00Z'), drops: [] });
    expect(packFromShop(events.packs[1], s, 'b')).toMatchObject({ currencyId: 'blood-rubies', season: false, endsAt: null });
  });

  it('finds the current or next challenge for a card', () => {
    expect(challengeFor({ name: 'Triborg, Sub-Zero (LK-52O)' }, events, NOW)?.start).toBe('2026-09-30T16:00:00Z');
    expect(challengeFor({ name: 'Kotal Kahn, Dark Lord' }, events, NOW)).toBeUndefined();
  });

  it('treats back-to-back weeks with the same name as one season', () => {
    expect(scheduledSeasonEnd(events, NOW)).toBe(local('2026-09-30T16:00:00Z'));
    expect(scheduledSeasonEnd(events, new Date('2026-10-01T00:00:00Z'))).toBe(local('2026-10-14T16:00:00Z'));
    expect(scheduledSeasonEnd(events, new Date('2026-11-01T00:00:00Z'))).toBeNull();
  });
});
