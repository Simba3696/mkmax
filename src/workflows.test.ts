import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Read as YAML, the way GitHub reads them, so comments, quoting and step names don't change what's checked.
type Step = {
  id?: string;
  uses?: string;
  run?: string;
  shell?: unknown;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
  if?: unknown;
  'continue-on-error'?: unknown;
};
type Job = {
  steps: Step[];
  name?: unknown;
  strategy?: unknown;
  env?: Record<string, unknown>;
  permissions?: unknown;
  defaults?: unknown;
  if?: unknown;
  needs?: unknown;
  outputs?: Record<string, unknown>;
  'continue-on-error'?: unknown;
};
type Workflow = { on: unknown; permissions?: unknown; defaults?: unknown; jobs: Record<string, Job> };

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (file: string): Workflow => parse(readFileSync(file, 'utf8'));
const ci = read(join(here, '..', '.github', 'workflows', 'ci.yml'));
const deploy = read(join(here, '..', '.github', 'workflows', 'deploy.yml'));
type Pkg = { scripts: Record<string, string>; dependencies?: object; devDependencies?: object };
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as Pkg;
const { scripts } = pkg;
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
  // why_new=the step list alone passes with a step that can't fail; seam=none; no_claim=main's ruleset that makes
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

  // Generated on 2026-10-25 (/ship review, pr-ci run 2 Red Team)
  // Value: protects=a pull request is built and tested under the /mkmax/ path the site is served from, as the deploy
  // does; fails_when=BASE_PATH is dropped or changed, or a step sets its own, so a broken asset, manifest or service
  // worker path passes the PR and fails after the merge; why_new=the PR job built with "/" while the deploy uses the
  // Pages path; seam=none; no_claim=that GitHub Pages serves the repo at /mkmax/ (the deploy reads that from Pages
  // itself)
  it('builds with the base path the site is served from', () => {
    expect([jobs.map((j) => j.env?.BASE_PATH), steps.filter((s) => s.env?.BASE_PATH !== undefined).length]).toEqual([
      ['/mkmax/'],
      0,
    ]);
  });

  // Generated on 2026-10-25 (/ship review, pr-ci run 2 pass 3)
  // Value: protects=pull requests can merge once their check passes; fails_when=the job is renamed, given a display
  // name or a matrix (GitHub then reports it under another name), so main's ruleset waits for a `check` that never
  // reports and every pull request stays blocked; why_new=the ruleset names the job and nothing in the repo tied the
  // two; seam=none; no_claim=what the live ruleset requires (set on GitHub)
  it('keeps the job name main requires', () => {
    const job = ci.jobs.check;
    expect([Object.keys(ci.jobs), job?.name, job?.strategy]).toEqual([['check'], undefined, undefined]);
  });

  // Generated on 2026-10-25 (/ship adversarial review, pr-ci run 4)
  // Value: protects=the check really lints, tests and builds; fails_when=a pull request turns the lint, test or build
  // script in package.json into a no-op, so npm test passes without testing anything; why_new=the step list only
  // names the scripts; seam=none; no_claim=a pull request that changes this test as well (read those diffs by hand)
  // Extended by /ship adversarial review on 2026-10-25 (pr-ci run 5): lint fails on warnings too, so a missed hook
  // dependency (a warning in .oxlintrc.json) can't merge green.
  it('runs the real lint, test and build scripts', () => {
    expect([scripts.lint, scripts.test, scripts.build]).toEqual([
      'oxlint --deny-warnings',
      'vitest run',
      'tsc --noEmit && vite build',
    ]);
  });

  // Generated on 2026-10-25 (/ship adversarial review, pr-ci run 4)
  // Value: protects=the GitHub token isn't left on disk while npm ci runs dependency install scripts, in this workflow
  // and the deploy's build job; fails_when=a checkout step drops persist-credentials: false; why_new=checkout keeps
  // the token by default; seam=none; no_claim=what GitHub grants the token
  it('keeps the token off disk in both workflows', () => {
    const checkouts = [ci, deploy].flatMap((w) =>
      Object.values(w.jobs).flatMap((j) => j.steps.filter((s) => s.uses?.startsWith('actions/checkout'))),
    );
    expect(checkouts.map((s) => s.with?.['persist-credentials'])).toEqual([false, false]);
  });
});

describe('.github/workflows/deploy.yml', () => {
  // Generated on 2026-10-25 (/ship adversarial review, pr-ci run 5)
  // Value: protects=only the deploy job can publish the site, so the build job, which runs npm ci and the
  // dependencies' install scripts, has a token that can only read and can't get a Pages deploy token; fails_when=pages:
  // write or id-token: write moves back to the whole workflow or onto the build job, the build gets another write
  // permission, another job is added or the fallback job gets any permission, or the deploy job gets a step besides
  // deploy-pages
  // (a checkout or npm ci would run dependency code with the publishing token); why_new=they were set for the whole
  // workflow, so every job had them; seam=none; no_claim=that configure-pages and deploy-pages work with these (seen
  // on the first deploy after the merge)
  it('lets only the deploy job publish', () => {
    const deploySteps = deploy.jobs.deploy?.steps.map((s) => s.uses?.split('@')[0] ?? s.run);
    expect([
      Object.keys(deploy.jobs),
      deploy.permissions,
      deploy.jobs.build?.permissions,
      deploy.jobs.deploy?.permissions,
      deploy.jobs.fallback?.permissions,
      deploySteps,
    ]).toEqual([
      ['build', 'deploy', 'fallback'],
      { contents: 'read' },
      { contents: 'read', pages: 'read' },
      { pages: 'write', 'id-token': 'write' },
      {},
      ['actions/deploy-pages'],
    ]);
  });

  // Generated on 2026-10-26 (/ship adversarial review, pr-ci run 7)
  // Value: protects=a deploy that kept an older catalog or event schedule still publishes, then shows as a failed run,
  // so GitHub tells the owner; fails_when=either download step stops reporting its fallback, the build stops passing it
  // on, the failing job runs before the deploy or always, or it stops failing (no exit 1, or allowed to fail);
  // why_new=a fallback showed only as a warning on a green
  // run; seam=none; no_claim=that GitHub emails the owner (that's the account's notification settings)
  it('fails the run after publishing when a download fell back', () => {
    const { build, fallback } = deploy.jobs;
    const reports = (s: Step) => !!s.run?.includes('fell_back=true" >> "$GITHUB_OUTPUT"');
    const reporting = build?.steps.filter(reports).map((s) => s.id);
    const failing = (s: Step) => [s.uses, s.run?.trim().endsWith('exit 1'), s['continue-on-error']];
    const fallbackSteps = fallback?.steps.map(failing);
    const muted = fallback?.['continue-on-error'];
    expect([reporting, build?.outputs?.fell_back, fallback?.needs, fallback?.if, fallbackSteps, muted]).toEqual([
      ['catalog', 'events'],
      "${{ steps.catalog.outputs.fell_back == 'true' || steps.events.outputs.fell_back == 'true' }}",
      ['build', 'deploy'],
      "needs.build.outputs.fell_back == 'true'",
      [[undefined, true, undefined]],
      undefined,
    ]);
  });
});

describe('package.json', () => {
  // Extended by /ship coverage audit on 2026-10-25 (pr-ci run 6 pass 2): the app ships only React, and yaml, which
  // this file reads the workflows with, is a dev dependency.
  // Value: protects=AGENTS.md's two runtime dependencies, and a fresh install still having yaml for this test;
  // fails_when=yaml (or anything else) lands in dependencies (npm install without -D), or yaml leaves devDependencies;
  // why_new=nothing read the dependency lists, and knip already installs yaml, so the import above keeps working
  // without it listed; seam=none; no_claim=what the bundle contains (Vite leaves out what the app doesn't import)
  it('keeps two runtime dependencies, with yaml for these tests only', () => {
    expect([Object.keys(pkg.dependencies ?? {}).sort(), 'yaml' in (pkg.devDependencies ?? {})]).toEqual([
      ['react', 'react-dom'],
      true,
    ]);
  });
});
