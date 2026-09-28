import { useMemo } from 'react';
import { useStore } from '../store';
import { buildCtx, buildPlan, cardGoal, levelLabel, rankPacks, rankTargets, thresholdLevel, type Phase } from '../engine';
import { CardThumb, fmt, FusionLabel, NumInput, pct, RarityBadge, timeUntil, useNow } from '../ui';
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

export default function PlanView({ goto }: { goto: (t: 'packs' | 'cards' | 'settings') => void }) {
  const { state, update } = useStore();
  const now = useNow();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const plan = useMemo(() => buildPlan(ctx, now), [ctx, now]);
  const ranks = useMemo(() => rankPacks(ctx, now), [ctx, now]);
  const targets = useMemo(() => rankTargets(ctx, now).slice(0, 10), [ctx, now]);
  const curName = (id: string) => state.currencies.find((c) => c.id === id)?.name ?? id;
  // Kard counts only matter where some card is bought past the threshold (e.g. Realm Klash epics to max).
  const kardRarities = state.rarities.filter(
    (r) => r.fusionUpThreshold != null && (r.goal === 'max' || state.cards.some((c) => c.rarityId === r.id && cardGoal(c, r) === 'max')),
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
      <section className="card">
        <h2>Wallet</h2>
        {wallet}
      </section>

      <section className="card">
        <h2>What to buy</h2>
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
                  <div className="grow">
                    <div className="row-title">
                      {b.status === 'upcoming' ? 'Save for' : 'Buy'} <b>{b.count}×</b> {b.pack.name}
                    </div>
                    <div className="muted small">
                      {fmt(b.totalCost)} {curName(c.currencyId)} · value {fmt(b.ev)}
                    </div>
                  </div>
                  <PackTiming pack={b.pack} now={now} />
                </div>
              ))}
              {c.saveFor && (
                <p className="hint">
                  Next best: <b>{c.saveFor.pack.name}</b>. You need {fmt(c.saveFor.shortBy)} more {curName(c.currencyId)} for another purchase.
                </p>
              )}
            </div>
          ))}
        <p className="muted small">
          Limited-time packs are listed first, soonest-ending at the top. "Save for" means the pack hasn't started yet, so hold the currency for it.
        </p>
      </section>

      {kardRarities.some((r) => r.fusionUpKards > 0) && (
        <section className="card">
          <h2>Fusion Up Kard plan</h2>
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
        </section>
      )}

      <section className="card">
        <h2>Priority targets</h2>
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
                  {t.card.source && <span className="chip krypt">{t.card.source}</span>}
                </div>
                <div className="muted small">
                  <RarityBadge rule={rule} /> <FusionLabel card={t.card} rule={rule} /> · {t.copiesToMax} to {levelLabel(rule, t.target)}
                  {t.copiesToThreshold > 0 && thrLevel != null && thrLevel < t.target &&` · ${t.copiesToThreshold} to F${thr}`}
                  {t.inPacks === 0 && ' · not in any current pack'}
                </div>
              </div>
              <span className={`chip phase-${t.phase}`}>{PHASE_LABEL[t.phase]}</span>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Pack ranking</h2>
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
                      <div className="grow">
                        <div className="row-title">{r.pack.name}</div>
                        <div className="muted small">
                          {fmt(r.pack.cost)} {cur.name} · value {fmt(r.ev)} per buy
                        </div>
                        <div className="effbar" title={`${Math.round(eff * 100)}% efficiency`}>
                          <span style={{ width: `${eff * 100}%` }} />
                        </div>
                      </div>
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
      </section>
    </>
  );
}
