import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const ci = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const deploy = readFileSync(join(here, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
const runs = (yml: string) => [...yml.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1].trim());
const node = (yml: string) => /node-version: (\S+)/.exec(yml)?.[1];

describe('.github/workflows/ci.yml', () => {
  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=every pull request runs the three checks AGENTS.md says a change needs before it merges, since
  // merging to main deploys; fails_when=the trigger moves off pull_request or a check is dropped, renamed or reordered
  // so a PR shows green without it; why_new=the workflow is new and nothing else reads it; seam=the YAML read as text;
  // no_claim=that GitHub runs it (seen on the PR's checks)
  it('runs lint, tests and a build on every pull request', () => {
    expect([/^on:\s*\n\s+pull_request:/m.test(ci), runs(ci)]).toEqual([true, ['npm ci', 'npm run lint', 'npm test', 'npm run build']]);
  });

  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=a pull request is checked on the Node version the deploy builds with, so a PR that passes doesn't
  // fail at deploy (jsdom needs Node 22.22 or newer); fails_when=one workflow's node-version changes without the other;
  // why_new=the two workflows only agree by copy; seam=the YAML read as text; no_claim=the exact Node release GitHub picks
  it('uses the same Node version as the deploy', () => {
    expect([node(ci) !== undefined, node(ci)]).toEqual([true, node(deploy)]);
  });
});
