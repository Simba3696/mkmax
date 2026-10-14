import { useMemo } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { REALM_KLASH_CURRENCY, buildCtx, gearForecast, gearQueue, gearWaiting, levelLabel, moveInGearOrder, targetLevel } from '../engine';
import { CardThumb, daysFromNow, FoldCard, fmt, FusionLabel } from '../ui';
import { grow, hint, row, rowTitle } from '../classes';

/** The Realm Klash gear still to max, in buying order, with when each piece is done at the daily Blood Ruby income. */
function useGear() {
  const { state, update } = useStore();
  const { now, ctx } = usePlan();
  const gear = useMemo(() => gearQueue(ctx, now), [ctx, now]);
  const waiting = useMemo(() => gearWaiting(ctx, gear), [ctx, gear]);
  const rubies = state.currencies.find((c) => c.id === REALM_KLASH_CURRENCY);
  const done = useMemo(() => gearForecast(gear, rubies?.balance ?? 0, rubies?.perDay), [gear, rubies?.balance, rubies?.perDay]);
  const onDay = (days: number) => (days === 0 ? 'now' : `around ${daysFromNow(days, now)}`);
  return { state, update, now, ctx, gear, waiting, rubies, done, onDay, rubyName: rubies?.name ?? 'Blood Rubies' };
}

/** Realm Klash pieces nothing plans right now, since no store item for them is on sale. */
function Waiting({ names }: { names: string[] }) {
  if (!names.length) return null;
  const it = names.length === 1 ? 'it' : 'them';
  return (
    <p className={hint}>
      Not on sale now: {names.join(', ')}. Nothing plans {it} until {names.length === 1 ? "it's" : "they're"} back in the shop; then add {it} from In the shop on Packs.
    </p>
  );
}

/** Lines for the plan: when all the gear is maxed, and any piece not on sale. Nothing once it's all done. */
export function GearSummary() {
  const { rubies, done, onDay, rubyName, waiting } = useGear();
  const all = done.at(-1);
  const names = waiting.map((c) => c.name);
  if (!all) return <Waiting names={names} />;
  return (
    <>
      <p className={hint}>
        {all.days == null ? (
          <>
            Maxing the Realm Klash gear takes {fmt(all.total)} {rubyName} in all. Set how many you get a day in Settings → Currencies to see when it's done.
          </>
        ) : (
          <>
            Realm Klash gear all maxed <b>{onDay(all.days)}</b>
            {all.days > 0 && ` (${all.days} days at ${fmt(rubies?.perDay ?? 0)} a day)`}, for {fmt(all.total)} {rubyName}. Season rewards and other rubies bring
            it closer. Change the order in Settings → Blood Ruby gear order.
          </>
        )}
      </p>
      <Waiting names={names} />
    </>
  );
}

/** Settings: the order Blood Rubies max the Realm Klash gear in, with each piece's date. Gone once it's all maxed. */
export default function GearOrder() {
  const { update, now, ctx, gear, done, onDay, rubyName, waiting } = useGear();
  if (!gear.length && !waiting.length) return null;
  // Move a gear piece past its neighbour and save the whole order, so the list stays as shown. A tap with nothing left
  // to move (the pieces have gone, a sync already put them that way round, or put another piece on sale between them)
  // saves nothing.
  const move = (i: number, by: -1 | 1) =>
    update((d) => {
      const onSale = gearQueue(buildCtx(d), now).map((g) => g.card.id);
      const order = moveInGearOrder(d, gear[i].card.id, gear[i + by].card.id, by, onSale);
      if (!order) return noChange;
      d.gearOrder = order;
    });
  return (
    <FoldCard id="settings-gear" title="Blood Ruby gear order">
      {/* Only pieces not on sale left: there's no order to explain, just the line saying so. */}
      {gear.length > 0 && (
        <p className="text-muted text-small">
          Blood Rubies max these one at a time, top first, before buying any pack. A piece whose store item is out of purchases is skipped for now.
        </p>
      )}
      {/* From tablets on, keep the ↑/↓ buttons near the piece they move instead of at the far edge of a wide card. */}
      <div className="md:max-w-[40rem]">
        {gear.map((g, i) => {
          const rule = ctx.rules.get(g.card.rarityId);
          const cost = Math.min(...g.items.map((p) => p.cost));
          const days = done[i]?.days;
          return (
            <div key={g.card.id} className={`${row} items-center`}>
              <CardThumb card={g.card} rule={rule} />
              <div className={grow}>
                <div className={rowTitle}>
                  {i + 1}. {g.card.name}
                </div>
                <div className="text-muted text-small">
                  <FusionLabel card={g.card} rule={rule} /> · {fmt(g.need)} to {rule && levelLabel(rule, targetLevel(g.card, rule))} · {fmt(g.need * cost)} {rubyName}
                  {days != null && ` · maxed ${onDay(days)}`}
                </div>
              </div>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === gear.length - 1} aria-label="Move down">
                ↓
              </button>
            </div>
          );
        })}
        <Waiting names={waiting.map((c) => c.name)} />
      </div>
    </FoldCard>
  );
}
