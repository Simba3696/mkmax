import { useMemo } from 'react';
import { useStore } from '../store';
import { REALM_KLASH_CURRENCY, buildCtx, buildPlan, cardGoal, daysToAfford, gearForecast, gearQueue, isRealmKlashGear, levelLabel, rankPacks, rankTargets, recordPurchase, targetLevel, thresholdLevel, type CurrencyPlan, type Phase } from '../engine';
import { CardThumb, FoldCard, fmt, FusionLabel, NumInput, pct, RarityBadge, SOURCE_LABELS, timeUntil, useNow } from '../ui';
import { challengeFor, challengeWhen, useEvents } from '../events';
import type { Pack } from '../types';

const PHASE_LABEL: Record<Phase, string> = {
  unlock: 'Unlock',
  toThreshold: 'To Kard threshold',
  normal: 'Fusion',
  kardCovered: 'Kards cover it',
  maxed: 'Maxed',
  skip: 'Skip',
};

export function PackTiming({ pack, now }: { pack: Pack; now: Date }) {
  if (pack.startsAt && new Date(pack.startsAt) > now) return <span className="chip upcoming">starts in {timeUntil(pack.startsAt, now)}</span>;
  if (pack.endsAt) {
    const hours = (new Date(pack.endsAt).getTime() - now.getTime()) / 3600000;
    if (hours < 0) return <span className="chip muted">expired</span>;
    return <span className={`chip ${hours < 24 ? 'urgent' : 'limited'}`}>{timeUntil(pack.endsAt, now)} left</span>;
  }
  return <span className="chip muted">permanent</span>;
}

export default function PlanView({ goto, openPack }: { goto: (t: 'packs' | 'cards' | 'settings') => void; openPack: (id: string, pull?: boolean) => void }) {
  const { state, update } = useStore();
  const now = useNow();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const plan = useMemo(() => buildPlan(ctx, now), [ctx, now]);
  const ranks = useMemo(() => rankPacks(ctx, now), [ctx, now]);
  const targets = useMemo(() => rankTargets(ctx, now).slice(0, 10), [ctx, now]);
  const gear = useMemo(() => gearQueue(ctx, now), [ctx, now]);
  // Swap a gear piece with its neighbour and save the whole order, so the list stays as shown.
  const moveGear = (i: number, by: number) =>
    update((d) => {
      const ids = gear.map((g) => g.card.id);
      [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
      d.gearOrder = [...ids, ...(d.gearOrder ?? []).filter((id) => !ids.includes(id))];
    });
  const rubies = state.currencies.find((c) => c.id === REALM_KLASH_CURRENCY);
  const gearDone = useMemo(() => gearForecast(gear, rubies?.balance ?? 0, rubies?.perDay), [gear, rubies?.balance, rubies?.perDay]);
  const allGear = gearDone.at(-1);
  const onDay = (days: number) =>
    days === 0 ? 'now' : `around ${new Date(now.getTime() + days * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const events = useEvents();
  // Challenge Kameos you still need whose Elder challenge is on now or coming up, soonest first.
  const challengeKameos = state.cards
    .filter((c) => c.source === 'challenge')
    .flatMap((card) => {
      const ch = challengeFor(card, events, now);
      return ch ? [{ card, ch }] : [];
    })
    .sort((a, b) => (a.ch.start ?? '').localeCompare(b.ch.start ?? ''));
  const curName = (id: string) => state.currencies.find((c) => c.id === id)?.name ?? id;
  // A store item levels its card straight away. A random pack opens in Packs with "What did you pull?" showing.
  const buyNow = (pack: Pack) => {
    update((d) => void recordPurchase(d, pack.id, 1), `Bought ${pack.name}`);
    if (!pack.store) openPack(pack.id, true);
  };
  /** When the currency's daily income covers what "Save for" is short by, and whether the pack ends first. */
  const forecast = ({ currencyId, saveFor }: CurrencyPlan) => {
    const perDay = state.currencies.find((c) => c.id === currencyId)?.perDay;
    const days = saveFor && daysToAfford(saveFor.shortBy, perDay);
    if (!saveFor || !days) return null;
    const by = new Date(now.getTime() + days * 86400000);
    const endsFirst = saveFor.pack.endsAt && new Date(saveFor.pack.endsAt) < by;
    return (
      <>
        {' '}
        At {fmt(perDay!)} a day that's about {days} day{days === 1 ? '' : 's'}, around {by.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.
        {endsFirst && <b> It ends before then.</b>}
      </>
    );
  };
  // Kard counts only matter where some card is taken past the threshold with kards. Realm Klash gear doesn't
  // count: it's maxed with Blood Rubies.
  const kardRarities = state.rarities.filter(
    (r) =>
      r.fusionUpThreshold != null &&
      (r.goal === 'max' || state.cards.some((c) => c.rarityId === r.id && cardGoal(c, r) === 'max' && !isRealmKlashGear(state, c))),
  );

  const wallet = (
    <div className="wallet">
      {state.currencies.map((c, i) => (
        <label key={c.id} className="field">
          <span>{c.name}</span>
          <NumInput value={c.balance} min={0} onChange={(v) => update((d) => void (d.currencies[i].balance = v ?? 0))} />
        </label>
      ))}
      {kardRarities.map((r) => (
        <label key={r.id} className="field">
          <span>{r.label} Fusion Up Kards</span>
          <NumInput
            value={r.fusionUpKards}
            min={0}
            step={1}
            onChange={(v) => update((d) => void (d.rarities.find((x) => x.id === r.id)!.fusionUpKards = v ?? 0))}
          />
        </label>
      ))}
    </div>
  );

  if (state.cards.length === 0 || state.packs.length === 0) {
    return (
      <section className="card">
        <h2>Get started</h2>
        <ol className="steps">
          <li className={state.cards.length ? 'done' : ''}>
            Add the cards you care about and their current fusion in <a onClick={() => goto('cards')}>Cards</a>.
          </li>
          <li className={state.packs.length ? 'done' : ''}>
            Add the packs in the store right now, with the odds from each pack's info screen, in <a onClick={() => goto('packs')}>Packs</a>.
          </li>
          <li>Enter your Souls, Koins and Fusion Up Kards below. The plan will show up here.</li>
        </ol>
        <p className="muted small">
          Or go to <a onClick={() => goto('settings')}>Settings</a> to load your OneNote data or the sample data.
        </p>
        {wallet}
      </section>
    );
  }

  return (
    <>
      <FoldCard id="wallet" title="Wallet">
        {wallet}
      </FoldCard>

      <FoldCard id="buy" title="What to buy">
        {plan.currencies.every((c) => c.buys.length === 0 && !c.saveFor) && (
          <p className="muted">No worthwhile purchases. Add packs that drop cards you haven't maxed, or top up your balances.</p>
        )}
        {plan.currencies
          .filter((c) => c.buys.length || c.saveFor)
          .map((c) => (
            <div key={c.currencyId} className="plan-currency">
              <div className="plan-currency-head">
                <h3>{curName(c.currencyId)}</h3>
                <span className="muted small">
                  spend {fmt(c.spent)} of {fmt(c.startBalance)} · {fmt(c.startBalance - c.spent)} left
                </span>
              </div>
              {c.buys.map((b) => (
                <div key={b.pack.id} className="row plan-row">
                  <button className="row-link grow" onClick={() => openPack(b.pack.id)} title="Show in Packs">
                    <span className="row-title">
                      {b.status === 'upcoming' ? 'Save for' : 'Buy'} <b>{b.count}×</b> {b.pack.name}
                    </span>
                    <span className="muted small">
                      {fmt(b.totalCost)} {curName(c.currencyId)} · value {fmt(b.ev)}
                    </span>
                  </button>
                  <PackTiming pack={b.pack} now={now} />
                  {b.status === 'active' && (
                    <button
                      className="small"
                      onClick={() => buyNow(b.pack)}
                      title={b.pack.store ? 'Adds a purchase, deducts the cost and levels up the card' : 'Adds a purchase, deducts the cost and opens the pack to log what you pulled'}
                    >
                      Bought one
                    </button>
                  )}
                </div>
              ))}
              {c.saveFor?.gear ? (
                <p className="hint">
                  Next: <a onClick={() => openPack(c.saveFor!.pack.id)}>{c.saveFor.pack.name}</a>. You need {fmt(c.saveFor.shortBy)} more {curName(c.currencyId)} for another copy.
                  {forecast(c)} Packs wait until the gear is maxed.
                </p>
              ) : (
                c.saveFor && (
                  <p className="hint">
                    Next best: <a onClick={() => openPack(c.saveFor!.pack.id)}>{c.saveFor.pack.name}</a>. You need {fmt(c.saveFor.shortBy)} more {curName(c.currencyId)} for another purchase.
                    {forecast(c)}
                  </p>
                )
              )}
            </div>
          ))}
        <p className="muted small">
          Tap a pack to jump to it in Packs, or <b>Bought one</b> to log a purchase here. Blood Ruby gear comes first, in the order below. Then limited-time packs are listed first, soonest-ending at the top. "Save for" means the pack hasn't started yet, so hold the currency for it.
        </p>
      </FoldCard>

      {gear.length > 0 && (
        <FoldCard id="gear" title="Blood Ruby gear order">
          <p className="muted small">
            Blood Rubies max these one at a time, top first, before buying any pack. A piece whose store item is out of purchases is skipped
            for now.
          </p>
          {allGear && (
            <p className="hint">
              {allGear.days == null ? (
                <>
                  Maxing all of it takes {fmt(allGear.total)} {curName(REALM_KLASH_CURRENCY)}. Set how many you get a day in Settings → Currencies to see
                  when it's done.
                </>
              ) : (
                <>
                  All maxed <b>{onDay(allGear.days)}</b>
                  {allGear.days > 0 && ` (${allGear.days} days at ${fmt(rubies?.perDay ?? 0)} a day)`}, for {fmt(allGear.total)}{' '}
                  {curName(REALM_KLASH_CURRENCY)} in all. Season rewards and other rubies bring it closer.
                </>
              )}
            </p>
          )}
          {gear.map((g, i) => {
            const rule = ctx.rules.get(g.card.rarityId);
            const cost = Math.min(...g.items.map((p) => p.cost));
            return (
              <div key={g.card.id} className="row">
                <CardThumb card={g.card} rule={rule} />
                <div className="grow">
                  <div className="row-title">
                    {i + 1}. {g.card.name}
                  </div>
                  <div className="muted small">
                    <FusionLabel card={g.card} rule={rule} /> · {fmt(g.need)} to {rule && levelLabel(rule, targetLevel(g.card, rule))} ·{' '}
                    {fmt(g.need * cost)} {curName('blood-rubies')}
                    {gearDone[i]?.days != null && ` · maxed ${onDay(gearDone[i].days)}`}
                  </div>
                </div>
                <button onClick={() => moveGear(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button onClick={() => moveGear(i, 1)} disabled={i === gear.length - 1} aria-label="Move down">
                  ↓
                </button>
              </div>
            );
          })}
        </FoldCard>
      )}

      {kardRarities.some((r) => r.fusionUpKards > 0) && (
        <FoldCard id="kards" title="Fusion Up Kard plan">
          {kardRarities.map((r) => {
            const plan = ctx.kardPlan.get(r.id);
            if (r.fusionUpKards <= 0 || !plan) return null;
            const used = r.fusionUpKards - plan.left;
            return (
              <div key={r.id}>
                <h3>
                  <RarityBadge rule={r} /> {r.fusionUpKards} kard{r.fusionUpKards === 1 ? '' : 's'}
                  {plan.assignments.length > 0 && <span className="muted small"> · uses {used}, {plan.left} left over</span>}
                </h3>
                {plan.assignments.length === 0 ? (
                  <p className="muted small">
                    Not enough kards for any step yet. Kards start at F{r.fusionUpThreshold}, and the cheapest step there costs{' '}
                    {r.kardsPerLevel[r.fusionUpThreshold ?? 0] || '?'}.
                  </p>
                ) : (
                  plan.assignments.map((a) => (
                    <div key={a.cardId} className="row">
                      <span className="grow">{ctx.cards.get(a.cardId)?.name}</span>
                      <span>
                        {levelLabel(r, a.from)} → <b>{levelLabel(r, a.to)}</b> <span className="muted small">({a.kards} kard{a.kards === 1 ? '' : 's'})</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
          <p className="muted small">Kards go to the cheapest steps first, since each step saves one pack copy. Guest cards count extra.</p>
        </FoldCard>
      )}

      {challengeKameos.length > 0 && (
        <FoldCard id="challenges" title="Elder challenges">
          <p className="muted small">Kameos you still need that an Elder challenge on MK Mobile Base's schedule gives for sure.</p>
          {challengeKameos.map(({ card, ch }) => (
            <div key={card.id} className="row">
              <CardThumb card={card} rule={state.rarities.find((r) => r.id === card.rarityId)} />
              <span className="grow">{card.name}</span>
              <span className={`chip ${ch.start && new Date(ch.start) > now ? 'limited' : 'urgent'}`}>{challengeWhen(ch, now)}</span>
            </div>
          ))}
        </FoldCard>
      )}

      <FoldCard id="targets" title="Priority targets">
        <p className="muted small">Ranked by how much the next copy is worth to you.</p>
        {targets.map((t) => {
          const rule = ctx.rules.get(t.card.rarityId);
          const thr = rule?.fusionUpThreshold;
          const thrLevel = rule ? thresholdLevel(rule) : null;
          return (
            <div key={t.card.id} className="row">
              <CardThumb card={t.card} rule={rule} size={40} />
              <div className="grow">
                <div className="row-title">
                  {t.card.name} {t.card.guest && <span className="chip guest">guest</span>}
                  {t.card.source && <span className="chip krypt">{SOURCE_LABELS[t.card.source]}</span>}
                </div>
                <div className="muted small">
                  <RarityBadge rule={rule} /> <FusionLabel card={t.card} rule={rule} />
                  {/* A Kameo's only goal is owning it, which "Not owned" already says. */}
                  {t.target > 1 && ` · ${t.copiesToMax} to ${levelLabel(rule, t.target)}`}
                  {t.copiesToThreshold > 0 && thrLevel != null && thrLevel < t.target &&` · ${t.copiesToThreshold} to F${thr}`}
                  {t.inPacks === 0 && ' · not in any current pack'}
                </div>
              </div>
              <span className={`chip phase-${t.phase}`}>{PHASE_LABEL[t.phase]}</span>
            </div>
          );
        })}
      </FoldCard>

      <FoldCard id="ranking" title="Pack ranking">
        <p className="muted small">
          Efficiency is value per cost, relative to the best pack in the same currency. It uses your cards as they are now.
        </p>
        {state.currencies.map((cur) => {
          const group = ranks.filter((r) => r.pack.currencyId === cur.id);
          if (!group.length) return null;
          const best = group[0].evPerK;
          return (
            <div key={cur.id}>
              <h3>{cur.name}</h3>
              {group.map((r) => {
                const eff = best > 0 ? r.evPerK / best : 0;
                return (
                  <div key={r.pack.id} className="rank">
                    <div className="row">
                      <button className="row-link grow" onClick={() => openPack(r.pack.id)} title="Show in Packs">
                        <span className="row-title">{r.pack.name}</span>
                        <span className="muted small">
                          {fmt(r.pack.cost)} {cur.name} · value {fmt(r.ev)} per buy
                        </span>
                        <span className="effbar" title={`${Math.round(eff * 100)}% efficiency`}>
                          <span style={{ width: `${eff * 100}%` }} />
                        </span>
                      </button>
                      <div className="rank-side">
                        <PackTiming pack={r.pack} now={now} />
                        <span className="small">{Math.round(eff * 100)}%</span>
                      </div>
                    </div>
                    {r.targets.slice(0, 3).map((t) => (
                      <div key={t.card.id} className="target muted small">
                        {t.card.name}: {pct(t.pAtLeastOne)} per buy · about {fmt(t.buysPerCopy)} buys per copy
                      </div>
                    ))}
                    {r.targets.length === 0 && <div className="target muted small">Nothing you still need.</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </FoldCard>
    </>
  );
}
