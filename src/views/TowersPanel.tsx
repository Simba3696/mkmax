import { useState } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { copiesToMax, copiesToThreshold, levelLabel, maxFusion, stepCard, targetLevel } from '../engine';
import { CardThumb, RarityBadge } from '../ui';
import { card, grow, row, rowTitle, stepper, stepperVal } from '../classes';
import type { Card } from '../types';

/** Tower gear with no tower name yet. */
const NO_TOWER = 'Tower not named';

type GearFilter = 'all' | 'belowThreshold';

/**
 * Cards tagged as tower gear, grouped by the tower they drop from. Maxed cards are pruned, so everything listed
 * still has copies to go.
 */
export default function TowersPanel() {
  const { state, update } = useStore();
  const { ctx } = usePlan();
  const [filter, setFilter] = useState<GearFilter>('all');
  // Gear whose level was tapped while the filter was on stays listed until it changes, so a piece raised to the kard
  // threshold doesn't vanish, with no Undo, before it can be tapped back.
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  const pickFilter = (v: GearFilter) => (setFilter(v), setTapped(new Set()));

  // A level tap steps from the level it showed: saving that level ± 1 would undo a level a sync has added since.
  const stepLevel = (c: Card, by: 1 | -1) => {
    if (filter !== 'all' && !tapped.has(c.id)) setTapped(new Set([...tapped, c.id]));
    update((d) => (d.cards.find((x) => x.id === c.id)?.fusion === c.fusion && stepCard(d, c.id, by) ? undefined : noChange));
  };

  const gear = state.cards.filter((c) => c.source === 'tower' && ctx.rules.has(c.rarityId));
  // Still needs copies before Fusion Up Kards can take over. Gear marked No kards, and a rarity with no kards, has no
  // threshold to reach, so it never counts.
  const belowThreshold = (c: Card) => copiesToThreshold(c, ctx.rules.get(c.rarityId)!) > 0;
  const shown = (c: Card) => filter === 'all' || belowThreshold(c) || tapped.has(c.id);
  const belowCount = gear.filter((c) => belowThreshold(c) || (filter === 'belowThreshold' && tapped.has(c.id))).length;

  // Grouped ignoring case, since tower names are typed by hand: "Lin kuei tower" files with "Lin Kuei Tower".
  const byTower = new Map<string, { tower: string; cards: Card[] }>();
  for (const c of gear) {
    if (!shown(c)) continue;
    const t = c.sourceNote?.trim() || NO_TOWER;
    const group = byTower.get(t.toLowerCase()) ?? { tower: t, cards: [] };
    group.cards.push(c);
    byTower.set(t.toLowerCase(), group);
  }
  const rarityOrder = (c: Card) => state.rarities.findIndex((r) => r.id === c.rarityId);
  const towers = [...byTower.values()]
    .map(({ tower, cards }) => ({ tower, cards: cards.sort((a, b) => rarityOrder(a) - rarityOrder(b) || a.name.localeCompare(b.name)) }))
    // Towers listing the most gear first; the unnamed group last.
    .sort((a, b) => Number(a.tower === NO_TOWER) - Number(b.tower === NO_TOWER) || b.cards.length - a.cards.length || a.tower.localeCompare(b.tower));
  const total = gear.length;

  return (
    <>
      <p className="text-muted text-small md:max-w-[80ch]">
        Tower gear is farmed, not bought, so it isn't part of the plan. These are the cards you've tagged as tower gear, grouped by tower. {total > 0 && `${total} items left in total.`}
      </p>
      {total === 0 && <p className="text-muted md:max-w-[80ch]">No tower gear left. Set a card's source to "Tower gear" on Cards and type the tower's name, or paste a list with the tower name (like "Kori Blade - Epic - Lin Kuei Tower - F2").</p>}
      {total > 0 && (
        <div className="flex flex-wrap gap-2 mb-[0.8rem] items-center">
          <select value={filter} onChange={(e) => pickFilter(e.target.value as GearFilter)} aria-label="Filter by kard threshold">
            <option value="all">{`All tower gear (${total})`}</option>
            <option value="belowThreshold">{`Below kard threshold (${belowCount})`}</option>
          </select>
        </div>
      )}
      {total > 0 && towers.length === 0 && <p className="text-muted md:max-w-[80ch]">None of your tower gear is below the kard threshold.</p>}
      {/* Towers flow into columns on wide screens; break-inside keeps each tower's card whole. Columns rather than a
          grid so a short tower doesn't leave a gap under itself beside a long one. */}
      <div className="lg:columns-2 2xl:columns-3 lg:gap-[0.8rem]">
        {towers.map(({ tower, cards }) => (
          <section key={tower} className={`${card} break-inside-avoid`}>
            <h2>
              {tower}{' '}
              <span className="text-muted text-small">{`${cards.length} ${filter === 'all' ? 'left' : 'below threshold'}`}</span>
            </h2>
            {cards.map((c) => {
              const rule = ctx.rules.get(c.rarityId)!;
              const max = maxFusion(rule);
              const toGo = copiesToMax(c, rule);
              return (
                <div key={c.id} className={`${row} items-center`}>
                  <CardThumb card={c} rule={rule} size={36} />
                  <div className={grow}>
                    <div className={rowTitle}>{c.name}</div>
                    <div className="text-small">
                      <RarityBadge rule={rule} />
                      <span className="text-muted">
                        {' '}
                        {toGo} {toGo === 1 ? 'copy' : 'copies'} to {levelLabel(rule, targetLevel(c, rule))}
                      </span>
                    </div>
                  </div>
                  <div className={stepper}>
                    <button onClick={() => stepLevel(c, -1)} disabled={c.fusion <= 0} aria-label="Lower level">
                      −
                    </button>
                    <span className={stepperVal}>{c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}</span>
                    <button onClick={() => stepLevel(c, 1)} disabled={c.fusion >= max} aria-label="Raise level">
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
