import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
// Spelled out from here (not from root) because gstack's pre-ship check maps a test to the files it names this way.
const config = JSON.parse(readFileSync(join(here, '..', '.gstack', 'pregate.json'), 'utf8')) as {
  dependencies: Record<string, string[]>;
};

// The files npm test runs, as Vitest itself lists them with vite.config.ts, so the two can't disagree. The VITEST_
// variables this worker runs with are left out so the listing is a fresh run. `dir` lists another folder the same way.
const vitestFiles = (dir = root) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
  const cli = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  // vite.config.ts spelled from here, as above, so the pre-ship check maps this test to it.
  const args = ['list', '--filesOnly', '--json', '--root', dir, '--config', join(here, '..', 'vite.config.ts')];
  const out = execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    // The test timeout can't stop a blocking call, so the listing gets its own.
    timeout: 50_000,
  });
  return (JSON.parse(out) as { file: string }[]).map((f) => relative(dir, f.file).replace(/\\/g, '/')).sort();
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

describe('vite.config.ts', () => {
  // Generated on 2026-10-25 (/ship coverage audit, pr-ci pass 1)
  // Value: protects=npm test runs this checkout's tests only, not the copies in Claude Code worktrees nested under
  // .claude/worktrees or in gstack's .gstack scratch, which run stale code twice and break the pre-ship check's lists;
  // fails_when=either exclude is dropped or misspelled, or a broader one also hides test files in other dot folders;
  // why_new=the listing test above only sees those copies when one happens to exist, and CI never has one;
  // seam=none; no_claim=which worktrees Claude Code makes (a scratch folder is listed with the real config)
  it('leaves nested worktrees and gstack scratch out of the test run', { timeout: 60_000 }, () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mkmax-vitest-')));
    try {
      for (const folder of ['src', '.claude/worktrees/copy/src', '.gstack/tmp', '.other']) {
        mkdirSync(join(dir, folder), { recursive: true });
        writeFileSync(join(dir, folder, 'a.test.ts'), "import { it } from 'vitest';\nit('runs', () => {});\n");
      }
      expect(vitestFiles(dir)).toEqual(['.other/a.test.ts', 'src/a.test.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
