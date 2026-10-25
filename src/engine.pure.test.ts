import { expect, it, vi } from 'vitest';

// Its own file, so loading React stays a failure only for the modules imported here.
vi.mock('react', () => {
  throw new Error('loaded React');
});

// Generated on 2026-10-25 (/ship review, run 17 pass 3, Red Team)
// Value: protects=the engine and the built-in game data it uses load without React (and without catalog.ts, which
// downloads the catalog and watches the page), as AGENTS.md requires, so scripts and plain tests can reuse them;
// fails_when=engine.ts, kaskets.ts or challenges.ts imports something that brings React in again (as nameKey in
// catalog.ts did); why_new=review: nothing checked it, and catalog.ts had started using React; seam=react mocked to
// throw on load; no_claim=other side effects
it('loads the engine and the game data it uses without React', async () => {
  await expect(import('./engine')).resolves.toHaveProperty('levelLabel');
  await expect(import('./challenges')).resolves.toBeTruthy();
});
