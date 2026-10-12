// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StoreProvider, useStore } from './store';
import { PlanProvider, usePlan } from './planner';

const seen: ReturnType<typeof usePlan>[] = [];
function View() {
  seen.push(usePlan());
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  seen.length = 0;
  vi.restoreAllMocks();
});

describe('the shared plan', () => {
  // Value: protects=every view reads one plan from PlanProvider, and a view left outside it fails loudly; fails_when=usePlan
  // returns null or works out its own plan per view; why_new=planner.tsx is new; seam=none; no_claim=the plan's contents
  // (engine tests) or that it moves on each minute
  it('throws outside a PlanProvider and gives every view the same plan inside one', () => {
    // React logs the thrown error too; keep the run's output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <StoreProvider>
          <View />
        </StoreProvider>,
      ),
    ).toThrow('usePlan needs a PlanProvider');
    cleanup();

    render(
      <StoreProvider>
        <PlanProvider>
          <View />
          <View />
        </PlanProvider>
      </StoreProvider>,
    );
    const [a, b] = seen.slice(-2);
    expect(a.plan).toBeDefined();
    expect(b).toBe(a);
  });

  // Value: protects=the shared plan is worked out again after a change, so no tab keeps showing the old one; fails_when=
  // PlanProvider's memo stops following the store; why_new=the test above renders once; seam=none; no_claim=the
  // once-a-minute clock
  it('works the plan out again after a change', () => {
    function Edit() {
      const { update } = useStore();
      const add = () => update((d) => void d.cards.push({ id: 'new', name: 'New card', rarityId: 'diamond', fusion: 0, guest: false }));
      return <button onClick={add}>Add a card</button>;
    }
    render(
      <StoreProvider>
        <PlanProvider>
          <Edit />
          <View />
        </PlanProvider>
      </StoreProvider>,
    );
    const before = seen.at(-1)!;
    act(() => screen.getByRole('button', { name: 'Add a card' }).click());
    const after = seen.at(-1)!;
    expect(after.ctx.state.cards.map((c) => c.id)).toContain('new');
    expect(after.plan).not.toBe(before.plan);
  });
});
