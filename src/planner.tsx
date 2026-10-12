// The planner's context and plan, worked out once per change (and again as the clock moves on, for dates) and shared
// by every view, so the Packs badge and the Plan tab don't each run the whole planner.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildCtx, buildPlan, type Ctx, type Plan } from './engine';
import { useStore } from './store';
import { useNow } from './ui';

interface Planned {
  /** The time the plan was worked out for; it moves on once a minute, and when the app comes back after a while away. */
  now: Date;
  ctx: Ctx;
  plan: Plan;
}

const PlanContext = createContext<Planned | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const now = useNow();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const plan = useMemo(() => buildPlan(ctx, now), [ctx, now]);
  const value = useMemo(() => ({ now, ctx, plan }), [now, ctx, plan]);
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const planned = useContext(PlanContext);
  if (!planned) throw new Error('usePlan needs a PlanProvider');
  return planned;
}
