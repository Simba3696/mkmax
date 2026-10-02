import { useMemo } from 'react';
import { useStore } from '../store';
import { REALM_KLASH_CURRENCY, buildCtx, gearForecast, gearQueue, levelLabel, targetLevel } from '../engine';
import { CardThumb, daysFromNow, fmt, FusionLabel, useNow } from '../ui';

/** The Realm Klash gear still to max, in buying order, with when each piece is done at the daily Blood Ruby income. */
function useGear() {
  const { state, update } = useStore();
  const now = useNow();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const gear = useMemo(() => gearQueue(ctx, now), [ctx, now]);
  const rubies = state.currencies.find((c) => c.id === REALM_KLASH_CURRENCY);
  const done = useMemo(() => gearForecast(gear, rubies?.balance ?? 0, rubies?.perDay), [gear, rubies?.balance, rubies?.perDay]);
  const onDay = (days: number) => (days === 0 ? 'now' : `around ${daysFromNow(days, now)}`);
  return { state, update, ctx, gear, rubies, done, onDay, rubyName: rubies?.name ?? 'Blood Rubies' };
}

/** One line for the plan: when all the gear is maxed. Nothing once it's all done. */
export function GearSummary() {
  const { rubies, done, onDay, rubyName } = useGear();
  const all = done.at(-1);
  if (!all) return null;
  return (
    <p className="hint">
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
  );
}

/** Settings: the order Blood Rubies max the Realm Klash gear in, with each piece's date. Gone once it's all maxed. */
export default function GearOrder() {
  const { update, ctx, gear, done, onDay, rubyName } = useGear();
  if (!gear.length) return null;
  // Swap a gear piece with its neighbour and save the whole order, so the list stays as shown.
  const move = (i: number, by: number) =>
    update((d) => {
      const ids = gear.map((g) => g.card.id);
      [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
      d.gearOrder = [...ids, ...(d.gearOrder ?? []).filter((id) => !ids.includes(id))];
    });
  return (
    <section className="card">
      <h2>Blood Ruby gear order</h2>
      <p className="muted small">
        Blood Rubies max these one at a time, top first, before buying any pack. A piece whose store item is out of purchases is skipped for now.
      </p>
      {gear.map((g, i) => {
        const rule = ctx.rules.get(g.card.rarityId);
        const cost = Math.min(...g.items.map((p) => p.cost));
        const days = done[i]?.days;
        return (
          <div key={g.card.id} className="row">
            <CardThumb card={g.card} rule={rule} />
            <div className="grow">
              <div className="row-title">
                {i + 1}. {g.card.name}
              </div>
              <div className="muted small">
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
    </section>
  );
}
