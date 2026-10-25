import { globSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
// Spelled out from here (not from root) because gstack's pre-ship check maps a test to the files it names this way.
const config = JSON.parse(readFileSync(join(here, '..', '.gstack', 'pregate.json'), 'utf8')) as {
  dependencies: Record<string, string[]>;
};
// The files npm test runs, found with Vitest's own patterns so the two can't disagree.
const testFiles = globSync(configDefaults.include, {
  cwd: root,
  exclude: (p) => configDefaults.exclude.some((g) => matchesGlob(String(p).replace(/\\/g, '/'), g)),
})
  .map((f) => f.replace(/\\/g, '/'))
  .sort();

describe('.gstack/pregate.json', () => {
  // Generated on 2026-10-25 (/ship review, pr-ci pass 3)
  // Value: protects=gstack's pre-ship check runs every test when the dependency files, tsconfig or Vitest's config
  // change; fails_when=a test file Vitest runs is added, renamed or removed without the same change in each of the four
  // lists; why_new=the lists were copied by hand and only a sentence in docs/development.md kept them up to date;
  // seam=none; no_claim=which tests npm test and CI run (always all of them)
  it('lists every test file for the files that affect all tests', () => {
    const lists = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'].map((f) =>
      [...(config.dependencies[f] ?? [])].sort(),
    );
    expect([testFiles.length > 0, lists]).toEqual([true, [testFiles, testFiles, testFiles, testFiles]]);
  });
});
