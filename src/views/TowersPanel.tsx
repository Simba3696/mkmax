import { useState } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { copiesToMax, copiesToThreshold, isRealmKlashGear, levelLabel, maxFusion, stepCard, targetLevel, thresholdLevel, towerKey, towerSpellings } from '../engine';
import { CardThumb, RarityBadge } from '../ui';
import { card, grow, row, rowTitle, stepper, stepperVal } from '../classes';
import type { Card } from '../types';

/** Tower gear with no tower name yet. */
const NO_TOWER = 'Tower not named';

type GearFilter = 'all' | 'belowThreshold' | 'unowned';

/**
 * Cards tagged as tower gear, grouped by the tower they drop from. Maxed cards are pruned, so everything listed
 * still has copies to go.
 */
export default function TowersPanel() {
  const { state, update } = useStore();
  const { ctx } = usePlan();
  const [filter, setFilter] = useState<GearFilter>('all');
  // Gear whose level was tapped while a filter was on stays listed until it changes, so a piece raised to the kard
  // threshold (or to F0, owned) doesn't vanish, with no Undo, before it can be tapped back. Counts say what still fits.
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  const pickFilter = (v: GearFilter) => (setFilter(v), setTapped(new Set()));

  // A level tap steps from the level it showed: saving that level ± 1 would undo a level a sync has added since.
  const stepLevel = (c: Card, by: 1 | -1) => {
    let stepped = false as boolean;
    update((d) => (d.cards.find((x) => x.id === c.id)?.fusion === c.fusion && (stepped = stepCard(d, c.id, by)) ? undefined : noChange));
    // Only a tap that changed the level keeps its piece listed: one a sync got to first saved nothing to tap back.
    if (stepped && filter !== 'all') setTapped((t) => (t.has(c.id) ? t : new Set([...t, c.id])));
  };

  const gear = state.cards.filter((c) => c.source === 'tower' && ctx.rules.has(c.rarityId));
  // Still needs copies before Fusion Up Kards can take over. Gear marked No kards, Realm Klash gear and a rarity with no
  // kards have no threshold to reach, so they never count.
  const belowThreshold = (c: Card) => !isRealmKlashGear(state, c) && copiesToThreshold(c, ctx.rules.get(c.rarityId)!) > 0;
  const unowned = (c: Card) => c.fusion === 0;
  const fits = (c: Card, f: GearFilter) => (f === 'belowThreshold' ? belowThreshold(c) : f === 'unowned' ? unowned(c) : true);
  const shown = (c: Card) => fits(c, filter) || tapped.has(c.id);
  const countFor = (f: GearFilter) => gear.filter((c) => fits(c, f)).length;

  // Grouped by towerKey: "Lin kuei tower" files with "Lin Kuei Tower". Each tower is spelled as the Tower list on Cards
  // spells it, whatever the filter shows.
  const spelling = towerSpellings(state);
  const byTower = new Map<string, { tower: string; cards: Card[] }>();
  for (const c of gear) {
    if (!shown(c)) continue;
    const t = c.sourceNote?.trim() || NO_TOWER;
    const group = byTower.get(towerKey(t)) ?? { tower: spelling.get(towerKey(t)) ?? t, cards: [] };
    group.cards.push(c);
    byTower.set(towerKey(t), group);
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
          <select value={filter} onChange={(e) => pickFilter(e.target.value as GearFilter)} aria-label="Filter tower gear">
            <option value="all">{`All tower gear (${total})`}</option>
            <option value="belowThreshold">{`Below kard threshold (${countFor('belowThreshold')})`}</option>
            <option value="unowned">{`Not owned (${countFor('unowned')})`}</option>
          </select>
        </div>
      )}
      {total > 0 && towers.length === 0 && (
        <p className="text-muted md:max-w-[80ch]">{filter === 'unowned' ? 'You own every piece of your tower gear.' : 'None of your tower gear is below the kard threshold.'}</p>
      )}
      {/* Towers flow into columns on wide screens; break-inside keeps each tower's card whole. Columns rather than a
          grid so a short tower doesn't leave a gap under itself beside a long one. */}
      <div className="lg:columns-2 2xl:columns-3 lg:gap-[0.8rem]">
        {towers.map(({ tower, cards }) => (
          <section key={tower} className={`${card} break-inside-avoid`}>
            <h2>
              {tower}{' '}
              <span className="text-muted text-small">{`${cards.filter((c) => fits(c, filter)).length} ${filter === 'all' ? 'left' : filter === 'unowned' ? 'not owned' : 'below threshold'}`}</span>
            </h2>
            {cards.map((c) => {
              const rule = ctx.rules.get(c.rarityId)!;
              const max = maxFusion(rule);
              const toGo = copiesToMax(c, rule);
              const target = targetLevel(c, rule);
              // The filter is for farming toward the kard threshold, so its distance leads; gear whose goal is the threshold
              // already shows it as copies to its goal.
              const thr = thresholdLevel(rule);
              const toThr = filter === 'belowThreshold' && thr != null && thr < target && belowThreshold(c) ? copiesToThreshold(c, rule) : 0;
              // Listed only because it was tapped out of the filter: dimmed and labelled with why, since the counts leave it
              // out. Its details line stays as it is, which dimmed would be too faint to read.
              const kept = !fits(c, filter);
              const why =
                filter === 'unowned' ? 'Owned now' : thr != null && c.fusion === thr ? 'At the kard threshold now' : thr != null && c.fusion > thr ? 'Past the kard threshold now' : 'No kard threshold now';
              return (
                <div key={c.id} className={`${row} items-center`}>
                  <div className={kept ? 'opacity-60' : undefined}>
                    <CardThumb card={c} rule={rule} size={36} />
                  </div>
                  <div className={grow}>
                    <div className={rowTitle}>
                      <span className={kept ? 'opacity-60' : undefined}>{c.name}</span>
                      {kept && (
                        <span className="text-muted text-small font-normal">
                          {' '}
                          <span className="whitespace-nowrap">· {why}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-small">
                      <RarityBadge rule={rule} />
                      <span className="text-muted">
                        {' '}
                        {/* Each count kept whole, so on a phone the line breaks at the dot rather than inside a count. */}
                        {toThr > 0 ? (
                          <>
                            <span className="whitespace-nowrap">{`${toThr} ${toThr === 1 ? 'copy' : 'copies'} to ${levelLabel(rule, thr!)}`}</span>
                            {' · '}
                            <span className="whitespace-nowrap">{`${toGo} ${toGo === 1 ? 'copy' : 'copies'} to ${levelLabel(rule, target)}`}</span>
                          </>
                        ) : (
                          <>
                            {toGo} {toGo === 1 ? 'copy' : 'copies'} to {levelLabel(rule, target)}
                          </>
                        )}
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
