import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mkmax-fetch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Starts both stand-ins for fetch below: a request counts as limited only when its signal came from
// AbortSignal.timeout, so a signal that never fires doesn't pass for a time limit.
const trackTimeouts = `const timed = new WeakSet();
const timeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => {
  const signal = timeout(ms);
  timed.add(signal);
  return signal;
};
const note = (url, opts) => process.stderr.write('REQUEST ' + JSON.stringify({ url: String(url), limited: timed.has(opts.signal) }) + '\\n');
`;

// Loaded before the script in place of the real fetch: it notes whether each request has a time limit, then fails
// the way an unreachable MK Mobile Base would, so nothing goes over the network.
const stub = join(dir, 'offline.mjs');
writeFileSync(
  stub,
  `${trackTimeouts}globalThis.fetch = async (url, opts = {}) => {
  note(url, opts);
  throw new Error('offline');
};
`,
);

/** A copy of a download script and schedule.mjs beside an empty public folder, so runs never write the repo's files. */
function scratchRepo(script) {
  const root = mkdtempSync(join(dir, 'repo-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'public'));
  for (const file of [script, 'schedule.mjs']) copyFileSync(join(here, file), join(root, 'scripts', file));
  return root;
}

/** The requests a run noted on stderr. */
const requestsOf = (stderr) =>
  stderr
    .split('\n')
    .filter((line) => line.startsWith('REQUEST '))
    .map((line) => JSON.parse(line.slice('REQUEST '.length)));

/**
 * Runs a copy of a download script offline, with the committed file it writes seeded into its public folder: its exit
 * code, the requests it made, and whether that file is untouched.
 */
function runOffline(script, output) {
  const root = scratchRepo(basename(script));
  const seeded = join(root, 'public', basename(output));
  copyFileSync(output, seeded);
  const before = readFileSync(seeded);
  const copy = join(root, 'scripts', basename(script));
  // PAGES_URL as the deploy sets it, so the deploy's own test run (which has it set) runs the same way.
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, copy], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PAGES_URL: 'https://live.test/mkmax' },
  });
  return { status: result.status, requests: requestsOf(result.stderr), unchanged: readFileSync(seeded).equals(before) };
}

// Loaded in place of the real fetch when MK Mobile Base answers: every catalog category has two pages of cards with
// art, the schedule has one pack and one current season, the live events.json has no past weeks, and the live
// catalog.json has as many cards of each kind as the download. Each request is noted as above. STUB_CHANGE makes the
// catalog answer the way a changed or failing API might: no page count, a page count of zero, a page count that never
// ends, no art, no rarity tags, page 1 whatever page is asked for, the same card twice, far fewer cards than the live
// copy, or pages slow enough that the download runs out of time (the stand-in moves the clock on a minute per request).
const online = join(dir, 'online.mjs');
writeFileSync(
  online,
  `${trackTimeouts}const when = { fields: [{ label: 'Start', value: '1 October 2026, 16:00 UTC' }, { label: 'End', value: 'Permanent' }] };
const schedule = {
  pages: [
    { id: 'packs', sections: [{ title: 'Available Packs', records: [{ name: 'Pack', ...when }] }] },
    { id: 'challenges', sections: [{ title: 'Current Challenges', records: [] }, { title: 'Upcoming Challenges', records: [] }] },
    { id: 'realm_wars', sections: [{ title: 'Current Season', records: [{ name: 'Week', ...when }] }, { title: 'Upcoming Seasons', records: [] }] },
  ],
};
const change = process.env.STUB_CHANGE;
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const live = ['character', 'equipment', 'kameo'].flatMap((kind) =>
  Array.from({ length: { shrunk: 20, 'small-drop': 5 }[change] ?? 2 }, () => ({ kind, rarity: 'gold' })),
);
const lastPage = change === 'no-page-count' ? undefined : change === 'zero-pages' ? 0 : change === 'endless' ? 1000 : 2;
const card = (n) => ({
  title: 'Card ' + n,
  slug: change === 'duplicate-slugs' ? 'card' : 'card-' + n,
  tags: change === 'no-rarity' ? [] : [{ slug: 'gold' }],
  image_url: change === 'no-art' ? undefined : 'https://img.test/' + n,
});
globalThis.fetch = async (url, opts = {}) => {
  note(url, opts);
  if (change === 'slow') skew += 61_000;
  const page = /[?&]page=(\\d+)/.exec(String(url));
  const current = page && (change === 'repeated-page' ? 1 : Number(page[1]));
  const body = page
    ? { data: [card(current)], meta: { last_page: lastPage, current_page: current } }
    : String(url).endsWith('/events.json')
      ? { seasons: [] }
      : String(url).endsWith('/catalog.json')
        ? { fetchedAt: '2026-10-20T17:30:00.000Z', items: live }
        : schedule;
  if (change === 'no-live-copy' && String(url).endsWith('/catalog.json')) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => body };
};
`,
);

/**
 * Runs a copy of a download script, writing into a scratch public folder, with MK Mobile Base answering (changed as
 * `change` says): its exit code, its errors, the requests it made, and whether it wrote catalog.json.
 */
function runOnline(script, change = '', localCatalog = null) {
  const root = scratchRepo(script);
  writeFileSync(join(root, 'public', 'events.json'), '{"seasons":[]}\n');
  if (localCatalog) writeFileSync(join(root, 'public', 'catalog.json'), JSON.stringify(localCatalog));
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(online).href, join(root, 'scripts', script)], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PAGES_URL: 'https://live.test/mkmax', STUB_CHANGE: change },
  });
  return {
    status: result.status,
    stderr: result.status ? result.stderr : '',
    requests: requestsOf(result.stderr),
    wroteCatalog: localCatalog
      ? JSON.parse(readFileSync(join(root, 'public', 'catalog.json'), 'utf8')).fetchedAt !== localCatalog.fetchedAt
      : existsSync(join(root, 'public', 'catalog.json')),
  };
}

describe('download scripts', () => {
  // Generated on 2026-10-25 (/ship pre-gate, pr-ci run 6)
  // Value: protects=a deploy whose MK Mobile Base download fails or stalls still goes out with the live copy, within
  // minutes; fails_when=a script's request loses its time limit (a stalled site would then hold the deploy until the
  // job's limit and fail it), or a failed download exits 0 or writes the file, so the workflow skips its fallback or
  // ships a broken copy; why_new=the time limits were added on this branch and nothing ran the scripts; seam=fetch is
  // replaced in the script's own process; no_claim=the 30-second length, or the workflow's curl fallback itself
  it('fail without writing when MK Mobile Base is unreachable, with a time limit on each request', () => {
    // The scripts spelled out from the repo root, so gstack's pre-ship check maps this test to them.
    expect([
      runOffline(join(here, '..', 'scripts', 'fetch-events.mjs'), join(here, '..', 'public', 'events.json')),
      runOffline(join(here, '..', 'scripts', 'fetch-catalog.mjs'), join(here, '..', 'public', 'catalog.json')),
    ]).toEqual([
      {
        status: 1,
        requests: [{ url: 'https://mkmobilebase.com/api/events/schedule', limited: true }],
        unchanged: true,
      },
      {
        status: 1,
        requests: [{ url: 'https://mkmobilebase.com/api/categories/characters/articles?per_page=100&page=1', limited: true }],
        unchanged: true,
      },
    ]);
  }, 45_000);

  // Extended by /ship coverage audit on 2026-10-25 (pr-ci run 6): every request, not just the first, has a time limit.
  // Value: protects=a stall on any MK Mobile Base request (a later page, a later category, or the live events.json the
  // schedule keeps past weeks from) fails the script so the deploy falls back instead of waiting; fails_when=a
  // refactor fetches later pages or categories, or the live copy, without the signal; why_new=the offline run above
  // fails on the first request, so it never reaches the others; seam=none (fetch is replaced in the script's own
  // process, and copies of the scripts write into a scratch folder); no_claim=the 30-second length
  it('put a time limit on every request when MK Mobile Base answers', () => {
    const page = (category, n) => `https://mkmobilebase.com/api/categories/${category}/articles?per_page=100&page=${n}`;
    const limited = (url) => ({ url, limited: true });
    expect([runOnline('fetch-events.mjs'), runOnline('fetch-catalog.mjs')]).toEqual([
      {
        status: 0,
        stderr: '',
        requests: ['https://mkmobilebase.com/api/events/schedule', 'https://live.test/mkmax/events.json'].map(limited),
        wroteCatalog: false,
      },
      {
        status: 0,
        stderr: '',
        requests: [
          ...['characters', 'equipment', 'kameos'].flatMap((c) => [page(c, 1), page(c, 2)]),
          'https://live.test/mkmax/catalog.json',
        ].map(limited),
        wroteCatalog: true,
      },
    ]);
  }, 45_000);

  // Generated on 2026-10-25 (/ship adversarial review, pr-ci run 6)
  // Value: protects=a catalog answer in a changed shape fails the script, so the deploy keeps the live catalog instead
  // of shipping part of it, running until the job's limit, or shipping cards without art; fails_when=the page count
  // check or the art check is dropped or loosened; why_new=the script only failed on an empty category; seam=none
  // (STUB_CHANGE only changes the stand-in's answers); no_claim=the 10% allowance
  // Extended by /ship coverage audit on 2026-10-25 (pr-ci run 7): a page count of zero, and cards with no rarity.
  // Value: protects=a catalog answer whose page count is zero (which stopped after page 1 before this branch) or whose
  // cards lost their rarity tags fails, so the deploy keeps the live catalog instead of shipping only the first page of
  // each category, or cards the app can't sort by rarity; fails_when=the page count check stops rejecting zero, or
  // rarity leaves the list of fields every card must mostly have; why_new=no-art only reaches the image half of that
  // check, and no case had a page count below 1; seam=none (STUB_CHANGE only changes the stand-in's answers);
  // no_claim=the 10% allowance, or a rarity read from the excerpt instead of the tags
  // Extended by /ship adversarial review on 2026-10-26 (pr-ci run 7): pages the site didn't send, repeated cards, a
  // catalog far smaller than the live one, and a download still going after 5 minutes.
  // Value: protects=a site that ignores the page asked for, repeats cards, loses a kind and rarity's cards, or answers
  // so slowly the deploy job would end first fails the script, so the deploy keeps the live catalog; fails_when=the
  // repeat check, the comparison with the live copy or the overall deadline is dropped;
  // why_new=each of these passed every earlier check; seam=none (STUB_CHANGE only changes the stand-in's answers and
  // clock); no_claim=the 90% and 5-minute values, or a live copy that can't be read (the committed one is used)
  it("fail without writing when MK Mobile Base's catalog answers look wrong or come too slowly", () => {
    const outcome = (change) => {
      const { status, wroteCatalog } = runOnline('fetch-catalog.mjs', change);
      return { change, status, wroteCatalog };
    };
    const changes = ['no-page-count', 'zero-pages', 'endless', 'no-art', 'no-rarity'];
    changes.push('repeated-page', 'duplicate-slugs', 'shrunk', 'slow');
    expect(changes.map(outcome)).toEqual(changes.map((change) => ({ change, status: 1, wroteCatalog: false })));
  }, 45_000);

  // Generated on 2026-10-26 (/ship review, pr-ci run 7 pass 4)
  // Value: protects=the comparison with an earlier catalog uses the newest copy (so committing a fresh catalog.json
  // resets it after a real removal), lets a small group lose a card or two, and doesn't fail when there's no earlier
  // copy (a first deploy); fails_when=the local copy stops standing in or being preferred when newer, an unreadable
  // live copy fails the download, or the allowance for small groups goes; why_new=every earlier case had a readable
  // live copy and no local one; seam=none (STUB_CHANGE only changes the stand-in's answers); no_claim=the exact
  // allowance (more than a tenth and more than 3)
  it('compare a catalog with the newest earlier copy, allowing a small group to lose a few cards', () => {
    const gold = (count) =>
      ['character', 'equipment', 'kameo'].flatMap((kind) => Array(count).fill({ kind, rarity: 'gold' }));
    const local = (fetchedAt, count) => ({ fetchedAt, items: gold(count) });
    const outcome = (change, localCatalog) => {
      const { status, wroteCatalog } = runOnline('fetch-catalog.mjs', change, localCatalog);
      return { status, wroteCatalog };
    };
    expect([
      outcome('no-live-copy'),
      outcome('no-live-copy', local('2026-10-01T17:30:00.000Z', 20)),
      outcome('shrunk', local('2026-10-25T17:30:00.000Z', 2)),
      outcome('', local('2026-10-01T17:30:00.000Z', 20)),
      outcome('small-drop'),
    ]).toEqual([
      { status: 0, wroteCatalog: true },
      { status: 1, wroteCatalog: false },
      { status: 0, wroteCatalog: true },
      { status: 0, wroteCatalog: true },
      { status: 0, wroteCatalog: true },
    ]);
  }, 45_000);
});
