import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Read as YAML, the way GitHub reads them, so comments, quoting and step names don't change what's checked.
type Step = { uses?: string; run?: string; with?: Record<string, unknown>; if?: unknown; 'continue-on-error'?: unknown };
type Job = { steps: Step[]; permissions?: unknown; if?: unknown; 'continue-on-error'?: unknown };
type Workflow = { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, Job> };

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (file: string): Workflow => parse(readFileSync(file, 'utf8'));
const ci = read(join(here, '..', '.github', 'workflows', 'ci.yml'));
const deploy = read(join(here, '..', '.github', 'workflows', 'deploy.yml'));
const jobs = Object.values(ci.jobs);
const steps = jobs.flatMap((j) => j.steps);
const nodeVersion = (w: Workflow) =>
  String(
    Object.values(w.jobs)
      .flatMap((j) => j.steps)
      .find((s) => s.uses?.startsWith('actions/setup-node'))?.with?.['node-version'],
  );

describe('.github/workflows/ci.yml', () => {
  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=every pull request runs the three checks AGENTS.md says a change needs before it merges, since
  // merging to main deploys; fails_when=the trigger moves off pull_request, a types, paths or branches filter skips
  // some PRs, or a check is dropped, renamed or reordered so a PR shows green without it; why_new=the workflow is new
  // and nothing else reads it; seam=none; no_claim=that GitHub runs it (seen on the PR's checks)
  // Extended by /ship coverage audit on 2026-10-25 (pr-ci pass 2): no step or job may be allowed to fail or be skipped.
  // Value: protects=a red lint, test or build shows red on the PR; fails_when=a step or the job gets an if: or
  // continue-on-error, so a failing or skipped check still shows a green PR that checked nothing; why_new=the step
  // list alone passes with a step that can't fail; seam=none; no_claim=branch protection that makes the check required
  it('runs lint, tests and a build on every pull request', () => {
    const muted = [...jobs, ...steps].filter((x) => x.if !== undefined || (x['continue-on-error'] ?? false) !== false);
    expect([
      Object.entries(ci.on).find(([trigger]) => trigger === 'pull_request'),
      steps.flatMap((s) => (s.run ? [s.run.trim()] : [])),
      muted.length,
    ]).toEqual([['pull_request', null], ['npm ci', 'npm run lint', 'npm test', 'npm run build'], 0]);
  });

  // Generated on 2026-10-25 (/ship coverage audit, pr-ci pass 2)
  // Value: protects=code in a pull request runs with a token that can only read the repo, so it can't push, tag or
  // comment; fails_when=the permissions block goes, contents becomes write, any other permission is added, or a job
  // sets its own permissions over the read-only ones; why_new=nothing read the permissions before; seam=none;
  // no_claim=the repo's default token setting or fork PR rules
  it('gives the job a read-only token', () => {
    expect([ci.permissions, jobs.map((j) => j.permissions)]).toEqual([{ contents: 'read' }, jobs.map(() => undefined)]);
  });

  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=a pull request is checked on the Node version the deploy builds with, so a PR that passes doesn't
  // fail at deploy (jsdom needs Node 22.22 or newer); fails_when=one workflow's node-version changes without the other;
  // why_new=the two workflows only agree by copy; seam=none; no_claim=the exact Node release GitHub picks
  it('uses the same Node version as the deploy', () => {
    expect([/^\d/.test(nodeVersion(ci)), nodeVersion(ci)]).toEqual([true, nodeVersion(deploy)]);
  });
});
