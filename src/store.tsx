import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultState, defaultWeights } from './defaults';

const KEY = 'mkmax:v1';

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* fall through to defaults */
  }
  return defaultState();
}

/**
 * Version 1 saves counted the first copy as F1; version 2 starts at F0. Shift owned levels up one,
 * reset built-in rarities to the new fusion tables (keeping kard counts), and extend custom ones.
 */
function migrateV1(s: Partial<AppState>): Partial<AppState> {
  const defaults = new Map(defaultState().rarities.map((r) => [r.id, r]));
  return {
    ...s,
    rarities: s.rarities?.map((r) => {
      const d = defaults.get(r.id);
      return d ? { ...d, label: r.label, color: r.color, fusionUpKards: r.fusionUpKards } : { ...r, dupesPerLevel: [...r.dupesPerLevel, 1] };
    }),
    cards: s.cards!.map((c) => {
      const { spare: _spare, ...rest } = c as typeof c & { spare?: number };
      return { ...rest, fusion: c.fusion > 0 ? c.fusion + 1 : 0, maxLevel: c.maxLevel != null ? c.maxLevel + 1 : c.maxLevel };
    }),
  };
}

/** Fill in fields missing from older saves or hand-edited imports. */
export function normalize(input: unknown): AppState {
  let s = input as Partial<AppState>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || !Array.isArray(s.packs)) {
    throw new Error('Not an MK Max save file');
  }
  if ((s.version as number) !== 2) s = migrateV1(s);
  const base = defaultState();
  return {
    version: 2,
    rarities: s.rarities?.length
      ? s.rarities.map((r) => ({
          ...r,
          fusionMax: r.fusionMax ?? 10,
          goal: r.goal ?? 'max',
          hasGuests: r.hasGuests ?? r.id === 'diamond',
        }))
      : base.rarities,
    currencies: s.currencies?.length ? s.currencies : base.currencies,
    cards: s.cards!,
    packs: s.packs!,
    towers: s.towers ?? [],
    weights: { ...defaultWeights, ...s.weights, tier: { ...defaultWeights.tier, ...s.weights?.tier } },
  };
}

type Update = (recipe: (draft: AppState) => void) => void;

const Ctx = createContext<{ state: AppState; update: Update; replace: (s: AppState) => void } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked; state still lives in memory */
    }
  }, [state]);

  const update: Update = (recipe) =>
    setState((prev) => {
      const draft = structuredClone(prev);
      recipe(draft);
      return draft;
    });

  return <Ctx.Provider value={{ state, update, replace: setState }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

export const newId = () => crypto.randomUUID().slice(0, 8);
