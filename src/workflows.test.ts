import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Read as YAML, the way GitHub reads them, so comments, quoting and step names don't change what's checked.
type Step = {
  uses?: string;
  run?: string;
  shell?: unknown;
  with?: Record<string, unknown>;
  if?: unknown;
  'continue-on-error'?: unknown;
};
type Job = { steps: Step[]; permissions?: unknown; defaults?: unknown; if?: unknown; 'continue-on-error'?: unknown };
type Workflow = { on: unknown; permissions?: unknown; defaults?: unknown; jobs: Record<string, Job> };

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (file: string): Workflow => parse(readFileSync(file, 'utf8'));
const ci = read(join(here, '..', '.github', 'workflows', 'ci.yml'));
const deploy = read(join(here, '..', '.github', 'workflows', 'deploy.yml'));
const jobs = Object.values(ci.jobs);
const steps = jobs.flatMap((j) => j.steps);
const isSetupNode = (s: Step) => !!s.uses?.startsWith('actions/setup-node');
const nodeVersion = (w: Workflow) =>
  String(
    Object.values(w.jobs)
      .flatMap((j) => j.steps)
      .find(isSetupNode)?.with?.['node-version'],
  );

// GitHub takes `on` as one event, a list of events, or a map of events to their filters.
const filtersOf = (on: unknown, event: string): unknown => {
  if (on === event || (Array.isArray(on) && on.includes(event))) return null;
  if (on && typeof on === 'object' && !Array.isArray(on) && event in on) {
    const filters = (on as Record<string, unknown>)[event];
    return filters && typeof filters === 'object' && Object.keys(filters).length ? filters : null;
  }
  return 'not a trigger';
};

describe('.github/workflows/ci.yml', () => {
  // Generated on 2026-10-25 (/ship pre-gate, pr-ci)
  // Value: protects=every pull request runs the three checks AGENTS.md says a change needs before it merges, since
  // merging to main deploys; fails_when=the trigger moves off pull_request, a types, paths or branches filter skips
  // some PRs, or a check is dropped, renamed or reordered so a PR shows green without it; why_new=the workflow is new
  // and nothing else reads it; seam=none; no_claim=that GitHub runs it (seen on the PR's checks)
  // Extended by /ship coverage audit on 2026-10-25 (pr-ci pass 2): no step or job may be allowed to fail or be skipped.
  // Value: protects=a red lint, test or build shows red on the PR; fails_when=a step or the job gets an if:, a
  // continue-on-error or its own shell, so a failing or skipped check still shows a green PR that checked nothing;
  // why_new=the step list alone passes with a step that can't fail; seam=none; no_claim=branch protection that makes
  // the check required
  it('runs lint, tests and a build on every pull request', () => {
    const muted = [...jobs, ...steps].filter((x) => x.if !== undefined || (x['continue-on-error'] ?? false) !== false);
    const ownShell = [ci.defaults, ...jobs.map((j) => j.defaults), ...steps.map((s) => s.shell)].filter(
      (x) => x !== undefined,
    );
    expect([
      filtersOf(ci.on, 'pull_request'),
      steps.flatMap((s) => (s.run ? [s.run.trim()] : [])),
      muted.length,
      ownShell.length,
    ]).toEqual([null, ['npm ci', 'npm run lint', 'npm test', 'npm run build'], 0, 0]);
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
  // fail at deploy (jsdom needs Node 22.22 or newer); fails_when=one workflow's node-version changes without the other,
  // or a second or late setup-node step switches Node for some of the checks; why_new=the two workflows only agree by
  // copy; seam=none; no_claim=the exact Node release GitHub picks
  it('uses the same Node version as the deploy', () => {
    const setups = steps.flatMap((s, i) => (isSetupNode(s) ? [i] : []));
    const install = steps.findIndex((s) => s.run?.trim() === 'npm ci');
    expect([/^\d/.test(nodeVersion(ci)), nodeVersion(ci), setups.length, setups[0] < install]).toEqual([
      true,
      nodeVersion(deploy),
      1,
      true,
    ]);
  });
});
