// Downloads MK Mobile Base's event schedule (its copy of mkmobileevent.com) into public/events.json: shop packs,
// challenges and Realm Klash seasons, with dates as ISO strings. The site doesn't allow cross-site requests, so
// the app reads this file instead. Run by the deploy workflow (daily and on every push), or: npm run events
import { writeFileSync } from 'node:fs';

const API = 'https://mkmobilebase.com/api/events/schedule';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mkmax events (https://github.com/Simba3696/mkmax)' };

const res = await fetch(API, { headers: HEADERS });
if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
const schedule = await res.json();

/** "September 23, 2026, 16:00 UTC" → ISO; "Permanent" or blank → null. */
function date(text) {
  if (!text || /permanent/i.test(text)) return null;
  const t = new Date(text.replace(/,\s*(\d{1,2}:\d{2})\s*UTC$/i, ' $1 UTC'));
  return isNaN(t.getTime()) ? null : t.toISOString();
}

const field = (record, label) => record.fields?.find((f) => f.label === label)?.value ?? null;
const section = (pageId, title) =>
  schedule.pages?.find((p) => p.id === pageId)?.sections?.find((s) => s.title === title)?.records ?? [];

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

const timed = (pageId, titles, nameField) =>
  titles.flatMap((t) => section(pageId, t)).map((r) => ({ name: field(r, nameField) ?? r.name, start: date(field(r, 'Start')), end: date(field(r, 'End')) }));

const pageIdOf = (title) => schedule.pages?.find((p) => p.sections?.some((s) => s.title === title))?.id;
const challenges = timed('challenges', ['Current Challenges', 'Upcoming Challenges'], 'Character');
const seasonPage = pageIdOf('Current Season');
const seasons = seasonPage ? timed(seasonPage, ['Current Season', 'Upcoming Seasons'], 'Rewards Type') : [];

writeFileSync(
  new URL('../public/events.json', import.meta.url),
  JSON.stringify({ source: 'https://mkmobilebase.com/en/events', fetchedAt: new Date().toISOString(), capturedAt: schedule.capturedAt ?? null, packs, challenges, seasons }, null, 1) + '\n',
);
console.log(`events: ${packs.length} packs, ${challenges.length} challenges, ${seasons.length} seasons (captured ${schedule.capturedAt})`);
