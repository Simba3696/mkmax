import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
// Spelled out from here (not from root) because gstack's pre-ship check maps a test to the files it names this way.
const config = JSON.parse(readFileSync(join(here, '..', '.gstack', 'pregate.json'), 'utf8')) as {
  dependencies: Record<string, string[]>;
};

// The files npm test runs, as Vitest itself lists them, so the two can't disagree. The VITEST_ variables this worker
// runs with are left out so the listing is a fresh run.
const vitestFiles = () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
  const cli = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const out = execFileSync(process.execPath, [cli, 'list', '--filesOnly', '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    // The test timeout can't stop a blocking call, so the listing gets its own.
    timeout: 50_000,
  });
  return (JSON.parse(out) as { file: string }[]).map((f) => relative(root, f.file).replace(/\\/g, '/')).sort();
};

describe('.gstack/pregate.json', () => {
  // Generated on 2026-10-25 (/ship review, pr-ci pass 3)
  // Value: protects=gstack's pre-ship check runs every test when the dependency files, tsconfig or Vitest's config
  // change; fails_when=a test file Vitest runs (anywhere, dot folders included) is added, renamed or removed without the
  // same change in each of the four lists; why_new=the lists were copied by hand and only a sentence in
  // docs/development.md kept them up to date; seam=none; no_claim=which tests npm test and CI run (always all of them)
  it('lists every test file for the files that affect all tests', { timeout: 60_000 }, () => {
    const testFiles = vitestFiles();
    const lists = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'].map((f) =>
      [...(config.dependencies[f] ?? [])].sort(),
    );
    expect([testFiles.length > 0, lists]).toEqual([true, [testFiles, testFiles, testFiles, testFiles]]);
  });
});
