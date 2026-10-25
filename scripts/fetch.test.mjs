import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
