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
  // merging to main deploys; fails_when=the trigger moves off pull_request, a types, paths or branches filter skips
  // some PRs, or a check is dropped, renamed or reordered so a PR shows green without it; why_new=the workflow is new
  // and nothing else reads it; seam=none; no_claim=that GitHub runs it (the YAML is read as text; seen on the PR's checks)
  // Extended by /ship coverage audit on 2026-10-25 (pr-ci pass 2): no step or job may be allowed to fail or be skipped.
  // Value: protects=a red lint, test or build shows red on the PR; fails_when=a step gets continue-on-error or an if:,
  // so a failing or skipped check still shows a green PR that checked nothing; why_new=the step list alone passes with
  // a step that can't fail; seam=none; no_claim=branch protection that makes the check required
  it('runs lint, tests and a build on every pull request', () => {
    // pull_request: with nothing nested under it, so no filter can skip a PR.
    const everyPr = /^on:[ \t]*\r?\n[ \t]+pull_request:[ \t]*\r?\n(?:[ \t]*\r?\n)*(?=\S)/m.test(ci);
    const muted = /continue-on-error|^[\s-]*if:/m.test(ci);
    expect([everyPr, runs(ci), muted]).toEqual([true, ['npm ci', 'npm run lint', 'npm test', 'npm run build'], false]);
  });

  // Generated on 2026-10-25 (/ship coverage audit, pr-ci pass 2)
  // Value: protects=code in a pull request runs with a token that can only read the repo, so it can't push, tag or
  // comment; fails_when=the permissions block goes, contents becomes write, or any other write permission is added;
  // why_new=nothing read the permissions before; seam=none; no_claim=the repo's default token setting or fork PR rules
  it('gives the job a read-only token', () => {
    const block = /^permissions:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m.exec(ci)?.[1];
    const granted = block?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect([granted, /:\s*write(-all)?\s*$/m.test(ci)]).toEqual([['contents: read'], false]);
  });

  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=a pull request is checked on the Node version the deploy builds with, so a PR that passes doesn't
  // fail at deploy (jsdom needs Node 22.22 or newer); fails_when=one workflow's node-version changes without the other;
  // why_new=the two workflows only agree by copy; seam=none; no_claim=the exact Node release GitHub picks (YAML read as text)
  it('uses the same Node version as the deploy', () => {
    expect([node(ci) !== undefined, node(ci)]).toEqual([true, node(deploy)]);
  });
});
