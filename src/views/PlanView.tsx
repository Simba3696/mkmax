import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { REALM_KLASH_CURRENCY, buildCtx, buildPlan, daysToAfford, fuseWithKards, kardStep, levelLabel, rankPacks, rankTargets, recordPurchase, thresholdLevel, type CurrencyPlan, type Phase } from '../engine';
import { CardThumb, Chip, daysFromNow, FoldCard, fmt, FusionLabel, NumInput, pct, RarityBadge, SOURCE_LABELS, timeUntil, useNow } from '../ui';
import { challengeFor, challengeWhen, useEvents } from '../events';
import type { Pack } from '../types';
import { GearSummary } from './GearOrder';
import { btn, card, field, grow, hint, row, rowTitle, type ChipTone } from '../classes';

const PHASE_LABEL: Record<Phase, string> = {
  unlock: 'Unlock',
  toThreshold: 'To Kard threshold',
  normal: 'Fusion',
  kardCovered: 'Kards cover it',
  maxed: 'Maxed',
  skip: 'Skip',
};
const PHASE_TONE: Record<Phase, ChipTone> = { unlock: 'unlock', toThreshold: 'warn', normal: 'plain', kardCovered: 'good', maxed: 'plain', skip: 'plain' };

/** A plan row: centred items, divider between consecutive rows. */
const planRow = `${row} items-center`;
/**
 * A row's text as a button (tap a pack in the plan to open it in Packs), styled like the plain row it replaces.
 * Pointer devices get a hover tint, matching the tap feedback on phones.
 */
const rowLink = `${grow} block min-h-0 py-[0.15rem] px-[0.3rem] -mx-[0.3rem] border-0 rounded-[6px] bg-transparent text-inherit text-left [&>span]:block active:bg-panel-2 md:hover:bg-panel-2`;
const note = 'text-muted text-small';
/** Pack ranking shows this many packs per currency until unfolded; the rest are rarely worth reading. */
const RANK_TOP = 3;
const rankToggle = `${btn.ghost} block min-h-0 mt-[0.3rem] py-[0.15rem] px-[0.3rem] -mx-[0.3rem] rounded-[6px] text-small text-gold`;
const done = 'text-muted line-through';
/** A pack ranking's top targets, indented under it. */
const target = `pl-[0.8rem] ${note}`;

export function PackTiming({ pack, now }: { pack: Pack; now: Date }) {
  if (pack.startsAt && new Date(pack.startsAt) > now) return <Chip tone="upcoming">starts in {timeUntil(pack.startsAt, now)}</Chip>;
  if (pack.endsAt) {
    const hours = (new Date(pack.endsAt).getTime() - now.getTime()) / 3600000;
    if (hours < 0) return <Chip tone="muted">expired</Chip>;
    return <Chip tone={hours < 24 ? 'urgent' : 'limited'}>{timeUntil(pack.endsAt, now)} left</Chip>;
  }
  return <Chip tone="muted">permanent</Chip>;
}

export default function PlanView({ goto, openPack }: { goto: (t: 'packs' | 'cards' | 'settings') => void; openPack: (id: string, pull?: boolean) => void }) {
  const { state, update, unreadable } = useStore();
  const now = useNow();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const plan = useMemo(() => buildPlan(ctx, now), [ctx, now]);
  const ranks = useMemo(() => rankPacks(ctx, now), [ctx, now]);
  /** Currencies whose full pack ranking is showing; back to the top few when the Plan is reopened. */
  const [openRanks, setOpenRanks] = useState<ReadonlySet<string>>(new Set());
  const toggleRanks = (id: string) =>
    setOpenRanks((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const targets = useMemo(() => rankTargets(ctx, now).slice(0, 10), [ctx, now]);
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
    const endsFirst = saveFor.pack.endsAt && new Date(saveFor.pack.endsAt).getTime() < now.getTime() + days * 86400000;
    return (
      <>
        {' '}
        At {fmt(perDay!)} a day that's about {days} day{days === 1 ? '' : 's'}, around {daysFromNow(days, now)}.
        {endsFirst && <b> It ends before then.</b>}
      </>
    );
  };
  // Kard counts only matter where cards are taken past the threshold with kards, which is a rarity tracked to max.
  // A gear card with its own Goal of Max doesn't count: that's Realm Klash gear, maxed with Blood Rubies.
  const kardRarities = state.rarities.filter((r) => r.kind !== 'kameo' && r.fusionUpThreshold != null && r.goal === 'max');

  const wallet = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-[0.6rem] md:items-end">
      {state.currencies.map((c, i) => (
        <label key={c.id} className={field}>
          <span>{c.name}</span>
          <NumInput value={c.balance} min={0} onChange={(v) => update((d) => void (d.currencies[i].balance = v ?? 0))} />
        </label>
      ))}
      {kardRarities.map((r) => (
        <label key={r.id} className={field}>
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
      // Line length stays readable on wide screens; phones are narrower than this anyway.
      <section className={`${card} md:max-w-page`}>
        <h2>Get started</h2>
        <ol className="list-decimal pl-[40px] my-[1em] [&>li]:my-[0.4rem]">
          <li className={state.cards.length ? done : undefined}>
            Add the cards you care about and their current fusion in <a onClick={() => goto('cards')}>Cards</a>.
          </li>
          <li className={state.packs.length ? done : undefined}>
            Add the packs in the store right now, with the odds from each pack's info screen, in <a onClick={() => goto('packs')}>Packs</a>.
          </li>
          <li>Enter your currency balances and Fusion Up Kards below. The plan will show up here.</li>
        </ol>
        {unreadable != null && (
          <p className={hint}>
            The data saved in this browser couldn't be read, so MK Max started fresh. To download it, go to <a onClick={() => goto('settings')}>Settings</a> → Data.
          </p>
        )}
        <p className={note}>
          Or go to <a onClick={() => goto('settings')}>Settings</a> and load the sample data to try it out first.
        </p>
        {wallet}
      </section>
    );
  }

  // Wide screens flow the sections into columns (CSS columns, so DOM and tab order stay top to bottom). The column
  // count follows the width the Plan actually gets (a container query, not the viewport, since the rail widens at lg;
  // 55.5rem/83rem are ~832px/1245px at the 15px root, so a column is never under ~400px), and forced breaks pin each
  // section to its column so folding one never moves others across. Pack ranking is always the last section and
  // Priority targets the one before it; the 3rd is the first of kards / challenges / targets.
  // Two columns: wallet, buy, kards, challenges | targets, ranking. Three: wallet, buy | kards, challenges, targets | ranking.
  return (
    <div className="@container">
      <div className="@min-[55.5rem]:columns-2 @min-[83rem]:columns-3 @min-[55.5rem]:gap-[0.8rem] @min-[55.5rem]:[&>section]:break-inside-avoid @min-[55.5rem]:[&>section:nth-last-child(2)]:break-before-column @min-[83rem]:[&>section:nth-last-child(2):not(:nth-child(3))]:break-before-auto @min-[83rem]:[&>section:nth-child(3)]:break-before-column @min-[83rem]:[&>section:last-child]:break-before-column">
        <FoldCard id="wallet" title="Wallet">
          {wallet}
        </FoldCard>

        <FoldCard id="buy" title="What to buy">
          {plan.currencies.every((c) => c.buys.length === 0 && !c.saveFor) && (
            <p className="text-muted">No worthwhile purchases. Add packs that drop cards you haven't maxed, or top up your balances.</p>
          )}
          {plan.currencies
            .filter((c) => c.buys.length || c.saveFor)
            .map((c) => (
              <div key={c.currencyId} className="[&+&]:mt-[0.9rem]">
                <div className="flex justify-between items-baseline flex-wrap gap-[0.4rem]">
                  <h3 className="my-[0.2rem]">{curName(c.currencyId)}</h3>
                  <span className={note}>
                    spend {fmt(c.spent)} of {fmt(c.startBalance)} · {fmt(c.startBalance - c.spent)} left
                  </span>
                </div>
                {c.buys.map((b) => (
                  <div key={b.pack.id} className={planRow}>
                    <button className={rowLink} onClick={() => openPack(b.pack.id)} title="Show in Packs">
                      <span className={`${rowTitle} [&_b]:text-gold`}>
                        {b.status === 'upcoming' ? 'Save for' : 'Buy'} <b>{b.count}×</b> {b.pack.name}
                      </span>
                      <span className={note}>
                        {fmt(b.totalCost)} {curName(c.currencyId)} · value {fmt(b.ev)}
                      </span>
                    </button>
                    <PackTiming pack={b.pack} now={now} />
                    {b.status === 'active' && (
                      <button
                        className="text-small"
                        onClick={() => buyNow(b.pack)}
                        title={b.pack.store ? 'Adds a purchase, deducts the cost and levels up the card' : 'Adds a purchase, deducts the cost and opens the pack to log what you pulled'}
                      >
                        Bought one
                      </button>
                    )}
                  </div>
                ))}
                {c.currencyId === REALM_KLASH_CURRENCY && <GearSummary />}
                {c.saveFor?.gear ? (
                  <p className={hint}>
                    Next: <a onClick={() => openPack(c.saveFor!.pack.id)}>{c.saveFor.pack.name}</a>. You need {fmt(c.saveFor.shortBy)} more {curName(c.currencyId)} for another copy.
                    {forecast(c)} Packs wait until the gear is maxed.
                  </p>
                ) : (
                  c.saveFor && (
                    <p className={hint}>
                      Next best: <a onClick={() => openPack(c.saveFor!.pack.id)}>{c.saveFor.pack.name}</a>. You need {fmt(c.saveFor.shortBy)} more {curName(c.currencyId)} for another purchase.
                      {forecast(c)}
                    </p>
                  )
                )}
              </div>
            ))}
          <p className={note}>
            Tap a pack to jump to it in Packs, or <b>Bought one</b> to log a purchase here. Blood Ruby gear comes first, in the order set in Settings. Then limited-time packs are listed first, soonest-ending at the top. "Save for" means the pack hasn't started yet, so hold the currency for it.
          </p>
        </FoldCard>

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
                    {plan.assignments.length > 0 && <span className={note}> · uses {used}, {plan.left} left over</span>}
                  </h3>
                  {plan.cards === 0 ? (
                    <p className={note}>
                      {plan.realmKlash > 0
                        ? `No ${r.label} card at F${r.fusionUpThreshold} or higher that kards can go to yet, so these kards wait. Realm Klash gear gets none.`
                        : `No ${r.label} card at F${r.fusionUpThreshold} or higher yet, so these kards wait.`}
                    </p>
                  ) : plan.assignments.length === 0 ? (
                    <p className={note}>
                      Not enough kards for any step yet{plan.cheapest != null ? `: the cheapest next step costs ${plan.cheapest}.` : '.'}
                    </p>
                  ) : (
                    plan.assignments.map((a) => {
                      const name = ctx.cards.get(a.cardId)?.name;
                      const cost = kardStep(state, a.cardId);
                      return (
                        <div key={a.cardId} className={planRow}>
                          <span className={grow}>{name}</span>
                          <span>
                            {levelLabel(r, a.from)} → <b>{levelLabel(r, a.to)}</b> <span className={note}>({a.kards} kard{a.kards === 1 ? '' : 's'})</span>
                          </span>
                          {/* One step per tap, as kards are used in the game; the plan updates after each. */}
                          {cost != null && (
                            <button
                              onClick={() => update((d) => void fuseWithKards(d, a.cardId), `Used ${cost} Fusion Up Kard${cost === 1 ? '' : 's'} on ${name}`)}
                              title={`Fuse ${name} to ${levelLabel(r, a.from + 1)} with ${cost} kard${cost === 1 ? '' : 's'} from the Wallet`}
                            >
                              Use {cost}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
            <p className={note}>Kards go to the cheapest steps first, since each step saves one pack copy. Guest cards count extra. After fusing in the game, tap <b>Use</b> to take the kards off the Wallet and raise the card one level.</p>
          </FoldCard>
        )}

        {challengeKameos.length > 0 && (
          <FoldCard id="challenges" title="Elder challenges">
            <p className={note}>Kameos you still need that an Elder challenge on MK Mobile Base's schedule gives for sure.</p>
            {challengeKameos.map(({ card, ch }) => (
              <div key={card.id} className={planRow}>
                <CardThumb card={card} rule={state.rarities.find((r) => r.id === card.rarityId)} />
                <span className={grow}>{card.name}</span>
                <Chip tone={ch.start && new Date(ch.start) > now ? 'limited' : 'urgent'}>{challengeWhen(ch, now)}</Chip>
              </div>
            ))}
          </FoldCard>
        )}

        <FoldCard id="targets" title="Priority targets">
          <p className={note}>Ranked by how much the next copy is worth to you.</p>
          {targets.map((t) => {
            const rule = ctx.rules.get(t.card.rarityId);
            const thr = rule?.fusionUpThreshold;
            const thrLevel = rule ? thresholdLevel(rule) : null;
            return (
              <div key={t.card.id} className={planRow}>
                <CardThumb card={t.card} rule={rule} size={40} />
                <div className={grow}>
                  <div className={rowTitle}>
                    {t.card.name} {t.card.guest && <Chip tone="guest">guest</Chip>}
                    {t.card.source && <Chip tone="source">{SOURCE_LABELS[t.card.source]}</Chip>}
                  </div>
                  <div className={note}>
                    <RarityBadge rule={rule} /> <FusionLabel card={t.card} rule={rule} />
                    {/* A Kameo's only goal is owning it, which "Not owned" already says. */}
                    {t.target > 1 && ` · ${t.copiesToMax} to ${levelLabel(rule, t.target)}`}
                    {t.copiesToThreshold > 0 && thrLevel != null && thrLevel < t.target &&` · ${t.copiesToThreshold} to F${thr}`}
                    {t.inPacks === 0 && ' · not in any current pack'}
                  </div>
                </div>
                <Chip tone={PHASE_TONE[t.phase]}>{PHASE_LABEL[t.phase]}</Chip>
              </div>
            );
          })}
        </FoldCard>

        <FoldCard id="ranking" title="Pack ranking">
          <p className={note}>
            Efficiency is value per cost, relative to the best pack in the same currency. It uses your cards as they are now.
          </p>
          {state.currencies.map((cur) => {
            const group = ranks.filter((r) => r.pack.currencyId === cur.id);
            if (!group.length) return null;
            const best = group[0].evPerK;
            const open = openRanks.has(cur.id);
            return (
              <div key={cur.id}>
                <h3>{cur.name}</h3>
                {(open ? group : group.slice(0, RANK_TOP)).map((r) => {
                  const eff = best > 0 ? r.evPerK / best : 0;
                  return (
                    <div key={r.pack.id} className="[&+&]:border-t [&+&]:border-line [&+&]:mt-[0.3rem] [&+&]:pt-[0.3rem]">
                      <div className={planRow}>
                        <button className={rowLink} onClick={() => openPack(r.pack.id)} title="Show in Packs">
                          <span className={rowTitle}>{r.pack.name}</span>
                          <span className={note}>
                            {fmt(r.pack.cost)} {cur.name} · value {fmt(r.ev)} per buy
                          </span>
                          <span className="h-[4px] bg-panel-2 rounded-[2px] mt-[5px] overflow-hidden" title={`${Math.round(eff * 100)}% efficiency`}>
                            <span className="block h-full bg-[linear-gradient(90deg,var(--color-red),var(--color-gold))]" style={{ width: `${eff * 100}%` }} />
                          </span>
                        </button>
                        <div className="flex flex-col items-end gap-[4px]">
                          <PackTiming pack={r.pack} now={now} />
                          <span className="text-small">{Math.round(eff * 100)}%</span>
                        </div>
                      </div>
                      {r.targets.slice(0, 3).map((t) => (
                        <div key={t.card.id} className={target}>
                          {t.card.name}: {pct(t.pAtLeastOne)} per buy · {t.withinBuys === 1 ? 'yours next buy' : t.withinBuys ? `yours within ${t.withinBuys} buys` : `about ${fmt(t.buysPerCopy)} buys per copy`}
                        </div>
                      ))}
                      {r.targets.length === 0 && <div className={target}>Nothing you still need.</div>}
                    </div>
                  );
                })}
                {group.length > RANK_TOP && (
                  <button className={rankToggle} aria-expanded={open} onClick={() => toggleRanks(cur.id)}>
                    {open ? 'Show fewer' : `Show ${group.length - RANK_TOP} more`}
                  </button>
                )}
              </div>
            );
          })}
        </FoldCard>
      </div>
    </div>
  );
}
