// Downloads MK Mobile Base's event schedule (its copy of mkmobileevent.com) into public/events.json: shop packs,
// challenges and Realm Klash seasons, with dates as ISO strings. The site doesn't allow cross-site requests, so
// the app reads this file instead. Run by the deploy workflow (daily and on every push), or: npm run events
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSchedule, withPastSeasons } from './schedule.mjs';

const API = 'https://mkmobilebase.com/api/events/schedule';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mkmax events (https://github.com/Simba3696/mkmax)' };
/** The deployed app; the workflow sets PAGES_URL. */
const LIVE = `${process.env.PAGES_URL ?? 'https://simba3696.github.io/mkmax'}/events.json`;
const FILE = new URL('../public/events.json', import.meta.url);

const res = await fetch(API, { headers: HEADERS });
if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
const schedule = await res.json();
const { packs, challenges, seasons } = parseSchedule(schedule);

/** A copy of events.json, or null if it can't be read. Past seasons are taken from it. */
async function earlierCopy(load, what) {
  try {
    return await load();
  } catch (e) {
    console.warn(`events: couldn't read the ${what} copy (${e.message})`);
    return null;
  }
}
// The deployed copy has the weeks this script kept on its last run; the local one (the committed copy in CI)
// covers a first deploy, or a live site that can't be reached.
const live = await earlierCopy(async () => {
  const r = await fetch(LIVE, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}, 'live');
const local = await earlierCopy(() => JSON.parse(readFileSync(FILE, 'utf8')), 'local');
const allSeasons = withPastSeasons(seasons, [live, local].flatMap((e) => e?.seasons ?? []), new Date());

writeFileSync(
  FILE,
  JSON.stringify(
    { source: 'https://mkmobilebase.com/en/events', fetchedAt: new Date().toISOString(), capturedAt: schedule.capturedAt ?? null, packs, challenges, seasons: allSeasons },
    null,
    1,
  ) + '\n',
);
console.log(
  `events: ${packs.length} packs, ${challenges.length} challenges, ${seasons.length} seasons and ${allSeasons.length - seasons.length} past weeks (captured ${schedule.capturedAt})`,
);
