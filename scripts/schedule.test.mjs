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

  // Generated on 2026-10-25 (/ship adversarial review, pr-ci run 6)
  // Value: protects=a schedule whose packs, challenges or seasons lose their names fails, so the deploy keeps the live
  // copy rather than one that breaks the Cards and Plan tabs, which read every name; fails_when=the name check is
  // dropped or misses one of the three lists; why_new=parseSchedule only checked sections and counts; seam=none;
  // no_claim=what the app does with a nameless entry in a copy it already has
  it('fails rather than writing an entry with no name', () => {
    const kold = [week('Kold', '30 September 2026, 16:00 UTC', '7 October 2026, 16:00 UTC')];
    const nameless = (edit) => {
      const schedule = api({ packs: [pack], current: kold, upcoming: [] });
      edit(schedule);
      return () => parseSchedule(schedule);
    };
    const dates = { Start: '30 September 2026, 16:00 UTC', End: '7 October 2026, 16:00 UTC' };
    expect(nameless(() => {})).not.toThrow();
    expect(nameless((s) => (s.pages[0].sections[0].records = [{ ...pack, name: '' }]))).toThrow(/no name/);
    expect(nameless((s) => (s.pages[1].sections[0].records = [record(undefined, dates)]))).toThrow(/no name/);
    expect(nameless((s) => (s.pages[2].sections[0].records = [week('', dates.Start, dates.End)]))).toThrow(/no name/);
  });

  // Generated on 2026-10-26 (/ship adversarial review, pr-ci run 20)
  // Value: protects=a season or challenge whose name field the site sent blank (rewards not announced yet) keeps the
  // entry's own name, so the schedule still deploys; fails_when=a blank field wins over the entry's name (the name
  // check then fails every refresh); why_new=every case had a filled field or no name at all; seam=none;
  // no_claim=what the site sends in that field
  // Generated on 2026-10-26 (/ship review, pr-ci run 20, owner decision D1 A)
  // Value: protects=a single pack, challenge or season with no name (one the site hasn't finished) is left out and the
  // rest of the schedule still deploys; fails_when=one nameless entry fails the whole refresh again, or it's written
  // with no name (the Cards and Plan tabs read every name); why_new=one nameless entry used to fail the script;
  // seam=none; no_claim=a whole list with no names, which still fails (the test above)
  it('leaves out a single entry with no name and keeps the rest', () => {
    const dates = { Start: '30 September 2026, 16:00 UTC', End: '7 October 2026, 16:00 UTC' };
    const kold = [week('Kold', dates.Start, dates.End)];
    const schedule = api({ packs: [pack, { ...pack, name: ' ' }], current: kold, upcoming: [] });
    const scorpion = record('SCORPION', { Character: 'Scorpion', ...dates });
    schedule.pages[1].sections[0].records = [scorpion, record(undefined, dates)];
    schedule.pages[2].sections[1].records = [week('', '7 October 2026, 16:00 UTC', '14 October 2026, 16:00 UTC')];
    const { packs, challenges, seasons } = parseSchedule(schedule);
    expect([packs, challenges, seasons].map((list) => list.map((e) => e.name))).toEqual([
      ['MK11 FROST SUMMON PACK'],
      ['Scorpion'],
      ['Kold'],
    ]);
  });

  it("names an entry by its own name when the site's name field is blank", () => {
    const dates = { Start: '30 September 2026, 16:00 UTC', End: '7 October 2026, 16:00 UTC' };
    const blank = record('GEAR WEEK', { 'Rewards Type': ' ', ...dates });
    const { seasons } = parseSchedule(api({ packs: [pack], current: [blank], upcoming: [] }));
    expect(seasons.map((s) => s.name)).toEqual(['GEAR WEEK']);
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

  // Generated on 2026-10-26 (/ship adversarial review, pr-ci run 7)
  // Value: protects=a nameless week in an older or hand-edited copy isn't carried into the new events.json, where it
  // would break the Cards and Plan tabs; fails_when=the name check on carried-over weeks is dropped; why_new=only fresh
  // entries were checked for names; seam=none; no_claim=weeks the site lists now (parseSchedule checks those)
  it("doesn't keep a past week with no name", () => {
    const w = (start, end, name) => ({ name, start, end });
    const current = [w('2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z', 'Kold')];
    const earlier = [w('2026-09-23T16:00:00.000Z', '2026-09-30T16:00:00.000Z', ''), w('2026-09-30T16:00:00.000Z', '2026-10-07T16:00:00.000Z')];
    expect(withPastSeasons(current, earlier, new Date('2026-10-08T00:00:00Z'))).toEqual(current);
  });

  // Generated on 2026-10-26 (/ship adversarial review, pr-ci run 16)
  // Value: protects=a broken week in an older or hand-edited copy (not an object, or dates that aren't text) is skipped
  // instead of crashing the events refresh every day until it ages out; fails_when=the shape checks on carried-over
  // weeks are dropped; why_new=only the name was checked; seam=none; no_claim=weeks the site lists now
  it('skips a past week that is broken rather than failing on it', () => {
    const w = (start, end, name) => ({ name, start, end });
    const current = [w('2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z', 'Kold')];
    const earlier = [null, 'week', w(1, '2026-09-30T16:00:00.000Z', 'Fire'), w('2026-09-23T16:00:00.000Z', {}, 'Ice')];
    expect(withPastSeasons(current, earlier, new Date('2026-10-08T00:00:00Z'))).toEqual(current);
  });

  // Generated on 2026-10-26 (/ship adversarial review, pr-ci run 16)
  // Value: protects=pack art that isn't an https link never reaches the app; fails_when=the https check on pack
  // art is dropped; why_new=pack art was copied as sent; seam=none; no_claim=what the site sends today (all https)
  it('keeps only https pack art', () => {
    const kold = [week('Kold', '30 September 2026, 16:00 UTC', '7 October 2026, 16:00 UTC')];
    const art = (image) =>
      parseSchedule(api({ packs: [{ ...pack, image }], current: kold, upcoming: [] })).packs[0].image;
    const sent = ['https://img.test/p.png', 'http://img.test/p.png', 'data:image/png;base64,AAAA', { url: 'x' }];
    expect(sent.map(art)).toEqual([
      'https://img.test/p.png',
      null,
      null,
      null,
    ]);
  });
});
