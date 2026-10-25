// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { applyAppUpdate, startServiceWorker, useAppUpdateReady } from './appUpdate';

// The service worker's hooks, caught here so a test can say a new build was found and see what Reload asks for.
const sw = vi.hoisted(() => ({ needRefresh: () => {}, update: vi.fn((_reload?: boolean) => Promise.resolve()) }));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (o: { onNeedRefresh: () => void }) => {
    sw.needRefresh = o.onNeedRefresh;
    return sw.update;
  },
}));

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  sw.update.mockClear();
  vi.stubGlobal('location', { reload });
  startServiceWorker();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app update', () => {
  // Generated on 2026-10-25 (/ship review, update approach)
  // Value: protects=a new build found while the app is open is only flagged as ready (the page's bar shows it) and never
  // reloads by itself, and Reload switches to it through the service worker; fails_when=finding a build reloads at once,
  // throwing away whatever is in progress (a half-filled form, a paste, a pull being logged), or Reload doesn't ask the
  // waiting worker to take over; why_new=the app no longer reloads by itself; seam=none; no_claim=a real service worker
  // update (registerSW mocked)
  it('flags a new version as ready without reloading, and Reload switches to it', () => {
    const { result } = renderHook(() => useAppUpdateReady());
    expect(result.current).toBe(false);
    act(() => sw.needRefresh());
    expect([result.current, reload.mock.calls.length, sw.update.mock.calls.length]).toEqual([true, 0, 0]);
    applyAppUpdate();
    expect(sw.update.mock.calls).toEqual([[true]]);
  });
});
