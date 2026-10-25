import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const config = JSON.parse(readFileSync(join(here, '..', '.gstack', 'pregate.json'), 'utf8')) as {
  dependencies: Record<string, string[]>;
};
const testFiles = ['src', 'scripts']
  .flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).map((f) => join(root, dir, f)))
  .filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f))
  .map((f) => relative(root, f).replace(/\\/g, '/'))
  .sort();

describe('.gstack/pregate.json', () => {
  // Generated on 2026-10-25 (/ship review, pr-ci pass 3)
  // Value: protects=gstack's pre-ship check runs every test when the dependency files or tsconfig change; fails_when=a
  // test file is added, renamed or removed without the same change in each of the three lists; why_new=the lists were
  // copied by hand and only a sentence in docs/development.md kept them up to date; seam=none; no_claim=which tests
  // npm test and CI run (always all of them)
  it('lists every test file for the files that affect all tests', () => {
    const lists = ['package.json', 'package-lock.json', 'tsconfig.json'].map((f) =>
      [...(config.dependencies[f] ?? [])].sort(),
    );
    expect(lists).toEqual([testFiles, testFiles, testFiles]);
  });
});
