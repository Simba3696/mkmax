import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultState } from './defaults';
import { decideSync, readRemote } from './sync';

const at = (updatedAt?: number) => ({ ...defaultState(), updatedAt });
/** A copy with a card in it, so it isn't the empty data of a device that has just been set up. */
const withCard = (updatedAt?: number) => ({ ...at(updatedAt), cards: [{ id: 'c1', name: 'Klassic Sub-Zero', rarityId: 'diamond', fusion: 1, guest: false }] });

describe('decideSync', () => {
  it('pushes when the gist is empty', () => {
    expect(decideSync(null, at(5), 0)).toBe('push');
  });

  it('pulls when only the other device changed', () => {
    expect(decideSync(at(20), at(10), 10)).toBe('pull');
  });

  it('pushes when only this device changed', () => {
    expect(decideSync(at(10), at(20), 10)).toBe('push');
  });

  it('asks the user when both changed', () => {
    expect(decideSync(at(30), withCard(20), 10)).toBe('conflict');
    // A device joining an existing gist (base 0) with its own data also asks.
    expect(decideSync(at(30), withCard(20), 0)).toBe('conflict');
  });

  it('pulls on a new device that has no edits of its own yet', () => {
    // A fresh install isn't stamped, even after the app sets the season end from the schedule.
    expect(decideSync(withCard(30), at(undefined), 0)).toBe('pull');
  });

  it('pushes the first edits of a fresh device that created the gist, which has no stamp', () => {
    expect(decideSync(at(undefined), at(20), 0)).toBe('push');
  });

  it('does nothing when both changed to the same data, like each moving the season end by itself', () => {
    const remote = { ...withCard(30), realmKlashSeasonEnd: '2026-10-21T16:00' };
    const local = { ...withCard(40), realmKlashSeasonEnd: '2026-10-21T16:00' };
    expect(decideSync(remote, local, 10)).toBe('none');
    // Key order doesn't matter.
    const reordered = Object.fromEntries(Object.entries(local).reverse()) as typeof local;
    expect(decideSync(remote, reordered, 10)).toBe('none');
    expect(decideSync(remote, { ...local, realmKlashSeasonEnd: '2026-10-22T16:00' }, 10)).toBe('conflict');
  });

  it('does nothing when both are already the same version', () => {
    expect(decideSync(at(10), at(10), 10)).toBe('none');
    expect(decideSync(at(20), at(20), 10)).toBe('none');
  });

  it('never pulls data from a build that shifted levels (version 2 or lower), even if it is newer', () => {
    const old = { ...at(30), version: 2 } as unknown as ReturnType<typeof at>;
    expect(decideSync(old, at(20), 10)).toBe('outdated');
    expect(decideSync(old, at(10), 10)).toBe('outdated');
  });

  it('neither pulls nor pushes data from a newer build, even if only this device changed', () => {
    const newer = { ...at(30), version: at().version + 1 } as unknown as ReturnType<typeof at>;
    expect(decideSync(newer, at(20), 10)).toBe('newer');
    expect(decideSync(newer, at(40), 30)).toBe('newer');
    expect(decideSync(at(30), at(10), 10)).toBe('pull'); // the same version is fine
  });
});

describe('GitHub requests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A request that never answers by itself, failing with the abort's reason the way a browser's fetch does. */
  const hang = (signal?: AbortSignal | null) => new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
  const cfg = { token: 't', gistId: 'g1', baseUpdatedAt: 0 };
  const gist = (content: string) => ({ ok: true, status: 200, json: () => Promise.resolve({ id: 'g1', description: null, files: { 'mkmax-data.json': { content, raw_url: 'raw' } } }) });

  // Generated on 2026-10-25 (/ship review, run 17 pass 2, testing)
  // Value: protects=a GitHub request that hangs (no answer, or an answer that stops halfway) gives up after 30 seconds
  // with a plain message, so the sync ends and a pull waiting on it stops spinning; one that answers in time is read as
  // usual; fails_when=the time limit goes, covers only the start of the answer, or cuts off a request that answered;
  // why_new=review: the pull stopped capping how long it waits for its sync, and these requests had no limit;
  // seam=fetch stubbed, fake timers; no_claim=a real connection
  it('gives up on a request that hangs after 30 seconds', async () => {
    vi.useFakeTimers();
    const timedOut = 'GitHub didn’t answer within 30 seconds. Check your connection.';
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => hang(init?.signal));
    const noAnswer = expect(readRemote(cfg)).rejects.toThrow(timedOut);
    await vi.advanceTimersByTimeAsync(30_000);
    await noAnswer;

    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: () => hang(init?.signal) }));
    const halfAnswer = expect(readRemote(cfg)).rejects.toThrow(timedOut);
    await vi.advanceTimersByTimeAsync(30_000);
    await halfAnswer;

    const saved = JSON.stringify(withCard(5));
    vi.stubGlobal('fetch', () => new Promise((r) => setTimeout(() => r(gist(saved)), 29_000)));
    const late = readRemote(cfg);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await late)?.updatedAt).toBe(5);
  });
});
