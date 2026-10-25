import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mkmax-fetch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Loaded before the script in place of the real fetch: it notes whether each request has a time limit, then fails
// the way an unreachable MK Mobile Base would, so nothing goes over the network.
const stub = join(dir, 'offline.mjs');
writeFileSync(
  stub,
  `globalThis.fetch = async (url, opts = {}) => {
  process.stderr.write('REQUEST ' + JSON.stringify({ url: String(url), limited: opts.signal instanceof AbortSignal }) + '\\n');
  throw new Error('offline');
};
`,
);

/** Runs a download script offline: its exit code, the requests it made, and whether the file it writes is untouched. */
function runOffline(script, output) {
  const before = readFileSync(output);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, script], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  const requests = result.stderr
    .split('\n')
    .filter((line) => line.startsWith('REQUEST '))
    .map((line) => JSON.parse(line.slice('REQUEST '.length)));
  return { status: result.status, requests, unchanged: readFileSync(output).equals(before) };
}

// Loaded in place of the real fetch when MK Mobile Base answers: every catalog category has two pages, the schedule has
// one pack and one current season, and the live events.json has no past weeks. Each request is noted as above.
const online = join(dir, 'online.mjs');
writeFileSync(
  online,
  `const when = { fields: [{ label: 'Start', value: '1 October 2026, 16:00 UTC' }, { label: 'End', value: 'Permanent' }] };
const schedule = {
  pages: [
    { id: 'packs', sections: [{ title: 'Available Packs', records: [{ name: 'Pack', ...when }] }] },
    { id: 'challenges', sections: [{ title: 'Current Challenges', records: [] }, { title: 'Upcoming Challenges', records: [] }] },
    { id: 'realm_wars', sections: [{ title: 'Current Season', records: [{ name: 'Week', ...when }] }, { title: 'Upcoming Seasons', records: [] }] },
  ],
};
globalThis.fetch = async (url, opts = {}) => {
  process.stderr.write('REQUEST ' + JSON.stringify({ url: String(url), limited: opts.signal instanceof AbortSignal }) + '\\n');
  const page = /[?&]page=(\\d+)/.exec(String(url));
  const body = page
    ? { data: [{ title: 'Card ' + page[1], slug: 'card-' + page[1], tags: [{ slug: 'gold' }] }], meta: { last_page: 2 } }
    : String(url).endsWith('/events.json')
      ? { seasons: [] }
      : schedule;
  return { ok: true, status: 200, json: async () => body };
};
`,
);

/** Runs a copy of a download script, writing into a scratch public folder, with MK Mobile Base answering. */
function runOnline(script) {
  const root = mkdtempSync(join(dir, 'repo-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'public'));
  for (const file of [script, 'schedule.mjs']) copyFileSync(join(here, file), join(root, 'scripts', file));
  writeFileSync(join(root, 'public', 'events.json'), '{"seasons":[]}\n');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(online).href, join(root, 'scripts', script)], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PAGES_URL: 'https://live.test/mkmax' },
  });
  const requests = result.stderr
    .split('\n')
    .filter((line) => line.startsWith('REQUEST '))
    .map((line) => JSON.parse(line.slice('REQUEST '.length)));
  return { status: result.status, stderr: result.status ? result.stderr : '', requests };
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
      },
      {
        status: 0,
        stderr: '',
        requests: ['characters', 'equipment', 'kameos'].flatMap((c) => [page(c, 1), page(c, 2)]).map(limited),
      },
    ]);
  }, 45_000);
});
