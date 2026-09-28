import { useMemo } from 'react';
import { useStore } from '../store';
import { buildCtx, copiesToMax, levelLabel, maxFusion, targetLevel } from '../engine';
import { CardThumb, RarityBadge } from '../ui';
import type { Card } from '../types';

/** Tower gear with no tower name (tagged by hand without one). */
const NO_TOWER = 'Tower not named';

/**
 * Cards tagged as tower gear, grouped by the tower they drop from. Maxed cards are pruned, so everything listed
 * still has copies to go.
 */
export default function TowersPanel() {
  const { state, update } = useStore();
  const ctx = useMemo(() => buildCtx(state), [state]);

  const patch = (id: string, p: Partial<Card>) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id);
      if (c) Object.assign(c, p);
    });

  const byTower = new Map<string, Card[]>();
  for (const c of state.cards) {
    if (c.source !== 'tower' || !ctx.rules.has(c.rarityId)) continue;
    const t = c.sourceNote?.trim() || NO_TOWER;
    byTower.set(t, [...(byTower.get(t) ?? []), c]);
  }
  const rarityOrder = (c: Card) => state.rarities.findIndex((r) => r.id === c.rarityId);
  const towers = [...byTower]
    .map(([tower, cards]) => ({ tower, cards: cards.sort((a, b) => rarityOrder(a) - rarityOrder(b) || a.name.localeCompare(b.name)) }))
    // Towers with the most gear left first; the unnamed group last.
    .sort((a, b) => Number(a.tower === NO_TOWER) - Number(b.tower === NO_TOWER) || b.cards.length - a.cards.length || a.tower.localeCompare(b.tower));
  const total = towers.reduce((a, t) => a + t.cards.length, 0);

  return (
    <>
      <p className="muted small">
        Tower gear is farmed, not bought, so it isn't part of the plan. These are the cards you've tagged as tower gear, grouped by tower. {total > 0 && `${total} items left in total.`}
      </p>
      {total === 0 && <p className="muted">No tower gear left. Set a card's source to "Tower gear" on Cards, or paste a list with the tower name (like "Kori Blade - Epic - Lin Kuei Tower - F2").</p>}
      {towers.map(({ tower, cards }) => (
        <section key={tower} className="card">
          <h2>
            {tower} <span className="muted small">{cards.length} left</span>
          </h2>
          {cards.map((c) => {
            const rule = ctx.rules.get(c.rarityId)!;
            const max = maxFusion(rule);
            const toGo = copiesToMax(c, rule);
            return (
              <div key={c.id} className="row">
                <CardThumb card={c} rule={rule} size={36} />
                <div className="grow">
                  <div className="row-title">{c.name}</div>
                  <div className="small">
                    <RarityBadge rule={rule} />
                    <span className="muted">
                      {' '}
                      {toGo} {toGo === 1 ? 'copy' : 'copies'} to {levelLabel(rule, targetLevel(c, rule))}
                    </span>
                  </div>
                </div>
                <div className="stepper">
                  <button onClick={() => patch(c.id, { fusion: Math.max(0, c.fusion - 1) })} disabled={c.fusion <= 0} aria-label="Lower level">
                    −
                  </button>
                  <span className="stepper-val">{c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}</span>
                  <button onClick={() => patch(c.id, { fusion: Math.min(max, c.fusion + 1) })} disabled={c.fusion >= max} aria-label="Raise level">
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
