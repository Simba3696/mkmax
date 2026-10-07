import { describe, expect, it } from 'vitest';
import { date, parseSchedule, withPastSeasons } from './schedule.mjs';
import { scheduledSeason } from '../src/events.ts';
import { toLocalInput } from '../src/engine.ts';

const local = (iso) => toLocalInput(new Date(iso));
const record = (name, fields) => ({ name, fields: Object.entries(fields).map(([label, value]) => ({ label, value })) });
const week = (rewards, start, end) => record(rewards.toUpperCase(), { 'Rewards Type': rewards, Start: start, End: end });

/** An API response shaped like the live one: the site lists the current week and the next, nothing before. */
function api({ packs, current, upcoming }) {
  return {
    capturedAt: '2026-10-07T12:50:55+00:00',
    pages: [
      { id: 'packs', sections: [{ title: 'Available Packs', records: packs }] },
      { id: 'challenges', sections: [{ title: 'Current Challenges', records: [] }, { title: 'Upcoming Challenges', records: [] }] },
      { id: 'realm_wars', sections: [{ title: 'Current Season', records: current }, { title: 'Upcoming Seasons', records: upcoming }] },
    ],
  };
}
const pack = record('MK11 FROST SUMMON PACK', { Start: '16 September 2026, 16:00 UTC', End: '7 October 2026, 16:00 UTC', Price: '15 Dragon Krystals', Limit: '' });

describe('event schedule script', () => {
  it('reads both date formats the site has used, and Permanent', () => {
    expect(date('30 September 2026, 16:00 UTC')).toBe('2026-09-30T16:00:00.000Z');
    expect(date('September 23, 2026, 16:00 UTC')).toBe('2026-09-23T16:00:00.000Z');
    expect(date('Permanent')).toBeNull();
  });

  it("fails rather than calling a date it can't read permanent", () => {
    expect(() => date('le 30 septembre')).toThrow(/can't read the date/);
    expect(() => date(null)).toThrow();
    const bad = record('PACK', { Start: 'soon', End: 'Permanent', Price: '1 Soul' });
    expect(() => parseSchedule(api({ packs: [bad], current: [week('Kold', '30 September 2026, 16:00 UTC', '7 October 2026, 16:00 UTC')], upcoming: [] }))).toThrow();
  });

  it('fails rather than writing an empty schedule when the site changes its format', () => {
    const kold = [week('Kold', '30 September 2026, 16:00 UTC', '7 October 2026, 16:00 UTC')];
    expect(() => parseSchedule(api({ packs: [], current: kold, upcoming: [] }))).toThrow(/no shop packs/);
    expect(() => parseSchedule(api({ packs: [pack], current: [], upcoming: [] }))).toThrow(/no current Realm Klash season/);
    const renamed = api({ packs: [pack], current: kold, upcoming: [] });
    renamed.pages[0].sections[0].title = 'Packs';
    expect(() => parseSchedule(renamed)).toThrow(/no "Available Packs" section/);
    expect(parseSchedule(api({ packs: [pack], current: kold, upcoming: [] })).packs).toMatchObject([
      { name: 'MK11 FROST SUMMON PACK', end: '2026-10-07T16:00:00.000Z', cost: 15, currency: 'Dragon Krystals', limit: null },
    ]);
  });

  it("keeps the season's earlier weeks after the site drops them, so an extended season is still one season", () => {
    // Captured during Kold's first week: Kold, then (added late) a second Kold week.
    const before = parseSchedule(
      api({
        packs: [pack],
        current: [week('Kold', '30 September 2026, 16:00 UTC', '7 October 2026, 16:00 UTC')],
        upcoming: [week('Kold', '7 October 2026, 16:00 UTC', '14 October 2026, 16:00 UTC')],
      }),
    );
    const deployed = { seasons: withPastSeasons(before.seasons, [], new Date('2026-10-07T17:30:00Z')) };
    // The next day's capture has only the second week and the season after.
    const after = parseSchedule(
      api({
        packs: [pack],
        current: [week('Kold', '7 October 2026, 16:00 UTC', '14 October 2026, 16:00 UTC')],
        upcoming: [week('Circle of Shadow', '14 October 2026, 16:00 UTC', '28 October 2026, 16:00 UTC')],
      }),
    );
    const seasons = withPastSeasons(after.seasons, deployed.seasons, new Date('2026-10-08T17:30:00Z'));
    expect(seasons.map((s) => s.start)).toEqual(['2026-09-30T16:00:00.000Z', '2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z']);
    expect(scheduledSeason({ fetchedAt: '', capturedAt: null, packs: [], challenges: [], seasons }, new Date('2026-10-09T00:00:00Z'))).toEqual({
      start: local('2026-09-30T16:00:00Z'),
      end: local('2026-10-14T16:00:00Z'),
      weekEnds: [local('2026-10-07T16:00:00Z')],
      complete: true,
    });
  });

  it('keeps past weeks for 4 weeks, once each, and never over a week the site still lists', () => {
    const w = (start, end, name = 'Kold') => ({ name, start, end });
    const now = new Date('2026-10-08T00:00:00Z');
    const current = [w('2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z')];
    const earlier = [
      w('2026-08-26T16:00:00.000Z', '2026-09-02T16:00:00.000Z', 'Old'), // ended over 4 weeks ago
      w('2026-09-30T16:00:00.000Z', '2026-10-07T16:00:00.000Z'),
      w('2026-09-30T16:00:00.000Z', '2026-10-07T16:00:00.000Z'), // in both the live and the committed copy
      w('2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z', 'Renamed since'),
    ];
    expect(withPastSeasons(current, earlier, now)).toEqual([w('2026-09-30T16:00:00.000Z', '2026-10-07T16:00:00.000Z'), ...current]);
  });
});
