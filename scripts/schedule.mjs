// Turns MK Mobile Base's event schedule (its /api/events/schedule response) into the lists in public/events.json.
// Kept apart from fetch-events.mjs, which does the downloading and writing, so it can be tested.

/** Weeks of a Realm Klash season that ended this long ago are still kept from an earlier copy (see withPastSeasons). */
const KEEP_PAST_SEASONS_MS = 28 * 24 * 60 * 60 * 1000;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * "30 September 2026, 16:00 UTC" (or "September 30, 2026, 16:00 UTC", as the site wrote it before) → ISO;
 * "Permanent" → null. Anything else throws: null means permanent, so a date the script can't read would otherwise
 * turn a limited pack into a permanent one without anyone noticing. It's matched by hand because new Date() reads
 * almost anything as some date.
 */
export function date(text) {
  const t = String(text ?? '').trim();
  if (/^permanent$/i.test(t)) return null;
  const m = /^(?:(\d{1,2}) ([a-z]+)|([a-z]+) (\d{1,2}),) (\d{4}), (\d{1,2}):(\d{2}) UTC$/i.exec(t);
  const month = m ? MONTHS.indexOf((m[2] ?? m[3]).toLowerCase()) : -1;
  if (month < 0) throw new Error(`events: can't read the date ${JSON.stringify(text)}`);
  return new Date(Date.UTC(Number(m[5]), month, Number(m[1] ?? m[4]), Number(m[6]), Number(m[7]))).toISOString();
}

const field = (record, label) => record.fields?.find((f) => f.label === label)?.value ?? null;

/**
 * Shop packs, challenges and Realm Klash seasons from the API response. Throws when a page or section is missing,
 * or there are no packs or no current season: the site has changed its format, and writing empty lists would
 * deploy an empty schedule. The deploy then keeps the copy that's live instead.
 */
export function parseSchedule(schedule) {
  const section = (pageId, title) => {
    const records = schedule.pages?.find((p) => p.id === pageId)?.sections?.find((s) => s.title === title)?.records;
    if (!Array.isArray(records)) throw new Error(`events: no "${title}" section on the ${pageId} page`);
    return records;
  };
  const timed = (pageId, titles, nameField) =>
    titles.flatMap((t) => section(pageId, t)).map((r) => ({ name: field(r, nameField) ?? r.name, start: date(field(r, 'Start')), end: date(field(r, 'End')) }));

  const packs = section('packs', 'Available Packs').map((r) => {
    const price = /^([\d,]+)\s+(.+)$/.exec(field(r, 'Price') ?? '');
    const limit = /^(\d+)/.exec(field(r, 'Limit') ?? '');
    return {
      name: r.name,
      start: date(field(r, 'Start')),
      end: date(field(r, 'End')),
      cost: price ? Number(price[1].replace(/,/g, '')) : null,
      currency: price ? price[2] : null,
      limit: limit ? Number(limit[1]) : null,
      image: r.image ?? null,
    };
  });
  const challenges = timed('challenges', ['Current Challenges', 'Upcoming Challenges'], 'Character');
  // Found by its section rather than its page id ("realm_wars"), which doesn't say Realm Klash.
  const seasonPage = schedule.pages?.find((p) => p.sections?.some((s) => s.title === 'Current Season'))?.id ?? 'realm_wars';
  const seasons = timed(seasonPage, ['Current Season', 'Upcoming Seasons'], 'Rewards Type');
  if (!packs.length) throw new Error('events: no shop packs');
  if (!section(seasonPage, 'Current Season').length) throw new Error('events: no current Realm Klash season');
  return { packs, challenges, seasons };
}

/**
 * `seasons` with the weeks before them that earlier copies of events.json listed and that ended in the last 4
 * weeks. The site lists only the current and next week, so the week that just ended is gone as soon as it
 * captures again. The app needs it: back-to-back weeks with the same name are one season, and the end of an
 * earlier week is where an older copy said the season ended (see scheduledSeason in src/events.ts).
 */
export function withPastSeasons(seasons, earlier, now) {
  const first = Math.min(...seasons.filter((s) => s.start).map((s) => new Date(s.start).getTime()));
  const kept = new Map();
  for (const s of earlier) {
    if (!s.start || !s.end || kept.has(s.start)) continue;
    const end = new Date(s.end).getTime();
    if (end <= first && end >= now.getTime() - KEEP_PAST_SEASONS_MS) kept.set(s.start, s);
  }
  return [...[...kept.values()].sort((a, b) => a.start.localeCompare(b.start)), ...seasons];
}
