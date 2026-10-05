import { Fragment, useEffect, useState } from 'react';
import { newId, useStore } from '../store';
import { REALM_KLASH_CURRENCY, levelLabel, maxFusion, moveSeasonEnd, packStatus, recordPurchase, seasonEnd, stepCard, toLocalInput, urgency } from '../engine';
import { CardThumb, ConfirmButton, fmt, useDeviceChoice, useNow } from '../ui';
import { actions, btn, card, field, grow, row, rowTitle, stepper, stepperVal, subpanel, toolbar } from '../classes';
import { PackTiming } from './PlanView';
import PackEditor from './PackEditor';
import { packFromShop, packName, scheduledSeasonEnd, shopSuggestions, useEvents } from '../events';
import type { Pack } from '../types';

const SORTS = ['ending', 'currency'] as const;
/** Muted small print under titles and in help text. */
const note = 'text-muted text-small';
/** A drop-rate pill: card name with its chance in gold. */
const drop = 'text-[0.8rem] bg-panel-2 rounded-[5px] py-[2px] px-[7px] [&_b]:text-gold';
/** Pack art in a shop suggestion, matching CardThumb. */
// max-w-none undoes preflight's max-width: 100% on images, which shaves the box a subpixel in a flex row.
const thumb = 'max-w-none flex-none rounded-panel border-2 border-line object-cover bg-panel-2';
type SortBy = (typeof SORTS)[number];

/** A pack opened from the plan: scrolled to and highlighted, with its "What did you pull?" step open when `pull`. */
export interface PackFocus {
  id: string;
  pull?: boolean;
}

/** focus: a pack tapped in the plan, scrolled to once the tab opens; onFocused clears it. */
export default function PacksView({ focus = null, onFocused }: { focus?: PackFocus | null; onFocused?: () => void }) {
  const focusId = focus?.id ?? null;
  const { state, update } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState<Pack | 'new' | null>(null);
  const focusPack = focusId ? state.packs.find((p) => p.id === focusId) : undefined;
  const [showExpired, setShowExpired] = useState(() => !!focusPack && packStatus(focusPack, now) === 'expired');
  const [flash, setFlash] = useState<string | null>(null);
  // Runs after App's layout effect has reset the scroll for the new tab, so this scroll wins.
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`pack-${focusId}`)?.scrollIntoView({ block: 'center' });
    setFlash(focusId);
    onFocused?.();
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  /** Random pack just bought: show its drop list so pulled cards can be levelled up in place. */
  const [pulling, setPulling] = useState<string | null>(focus?.pull ? focus.id : null);
  const rules = new Map(state.rarities.map((r) => [r.id, r]));
  const curName = (id: string) => state.currencies.find((c) => c.id === id)?.name ?? id;
  const cardName = (id: string) => state.cards.find((c) => c.id === id)?.name ?? '(deleted card)';

  const [sortBy, chooseSort] = useDeviceChoice('mkmax:packSort', SORTS);
  // By currency: in the order the currencies are listed in Settings, soonest-ending first within each.
  const curIndex = (p: Pack) => {
    const i = state.currencies.findIndex((c) => c.id === p.currencyId);
    return i < 0 ? state.currencies.length : i;
  };
  const groups = { active: [] as Pack[], upcoming: [] as Pack[], expired: [] as Pack[] };
  for (const p of state.packs) groups[packStatus(p, now)].push(p);
  for (const g of Object.values(groups)) g.sort((a, b) => (sortBy === 'currency' ? curIndex(a) - curIndex(b) : 0) || urgency(a) - urgency(b));
  /**
   * A status group's packs, with a currency heading before each currency's packs when sorted by currency. Phones stack
   * them; wider screens lay the cards out in a grid (headings span it), so the heading and card are siblings rather
   * than wrapped together. Block margins collapse the same either way, so phones look as before.
   */
  const renderGroup = (packs: Pack[]) =>
    packs.length > 0 && (
      <div className="lg:grid lg:grid-cols-2 2xl:grid-cols-3 lg:gap-x-[0.8rem] lg:items-start">
        {packs.map((p, i) => (
          <Fragment key={p.id}>
            {sortBy === 'currency' && p.currencyId !== packs[i - 1]?.currencyId && (
              <h4 className="col-span-full mt-[0.6rem] lg:mt-0 mb-[0.4rem] text-[0.8rem] font-bold text-muted uppercase tracking-[0.04em]">{curName(p.currencyId)}</h4>
            )}
            {renderPack(p)}
          </Fragment>
        ))}
      </div>
    );

  // Store items give a known card, so buying one levels it up; for random packs we ask what was pulled.
  const buy = (p: Pack, delta: 1 | -1) => {
    update((d) => void recordPurchase(d, p.id, delta), delta > 0 ? `Bought ${p.name}` : undefined);
    if (!p.store) setPulling(delta > 0 ? p.id : null);
  };

  const duplicate = (p: Pack) => setEditing({ ...structuredClone(p), id: newId(), name: `${p.name} (rerun)`, purchased: 0, startsAt: null, endsAt: null });

  // Cards keep their own height in the grid (items-start), so opening one's pull panel doesn't stretch its neighbour.
  const renderPack = (p: Pack) => (
    <div
      key={p.id}
      id={`pack-${p.id}`}
      className={`${card} min-w-0 ${flash === p.id ? 'animate-pack-flash motion-reduce:animate-none motion-reduce:border-gold' : ''}`}
    >
      <div className={`${row} items-center`}>
        <div className={grow}>
          <div className={rowTitle}>{p.name}</div>
          <div className={note}>
            {fmt(p.cost)} {curName(p.currencyId)}
            {p.store && ' · store item'}
            {p.rolls > 1 && ` · ${p.rolls} cards per buy`} · bought {p.purchased}
            {p.maxPurchases != null && `/${p.maxPurchases}`}
          </div>
        </div>
        <PackTiming pack={p} now={now} />
      </div>
      <div className="flex flex-wrap gap-[0.3rem] mt-[0.4rem]">
        {p.drops.map((d, i) => (
          <span key={i} className={drop}>
            {cardName(d.cardId)} <b>{d.chance}%</b>
          </span>
        ))}
        {p.drops.length === 0 && <span className={note}>No drops entered yet.</span>}
      </div>
      <div className={actions}>
        {packStatus(p, now) === 'active' && (
          <>
            <button
              className={btn.primary}
              disabled={p.maxPurchases != null && p.purchased >= p.maxPurchases}
              onClick={() => buy(p, 1)}
              title={p.store ? 'Adds a purchase, deducts the cost and levels up the card' : 'Adds a purchase and deducts the cost from your balance'}
            >
              I bought one
            </button>
            {p.purchased > 0 && (
              <button onClick={() => buy(p, -1)} title="Remove one purchase and refund its cost" aria-label="Remove one purchase">
                −1
              </button>
            )}
          </>
        )}
        <button onClick={() => setEditing(p)}>Edit</button>
        <button onClick={() => duplicate(p)}>Rerun</button>
        <ConfirmButton label="Delete" onConfirm={() => update((d) => void (d.packs = d.packs.filter((x) => x.id !== p.id)), `Deleted ${p.name}`)} />
      </div>
      {pulling === p.id && (
        <div className={subpanel}>
          <div className="text-small">
            <b>What did you pull?</b> <span className="text-muted">Tap + for each copy you got. Cards you don't track can be ignored.</span>
          </div>
          {p.drops.map((d) => {
            const card = state.cards.find((c) => c.id === d.cardId);
            const rule = card && rules.get(card.rarityId);
            if (!card || !rule) return null;
            return (
              <div key={d.cardId} className={`${row} items-center`}>
                <CardThumb card={card} rule={rule} size={36} />
                <span className={grow}>{card.name}</span>
                <div className={stepper}>
                  <button onClick={() => update((s) => stepCard(s, card.id, -1))} disabled={card.fusion <= 0} aria-label="Remove a copy">
                    −
                  </button>
                  <span className={stepperVal}>{card.fusion === 0 ? '—' : levelLabel(rule, card.fusion)}</span>
                  <button onClick={() => update((s) => stepCard(s, card.id, 1))} disabled={card.fusion >= maxFusion(rule)} aria-label="Add a copy">
                    +
                  </button>
                </div>
              </div>
            );
          })}
          <div className={actions}>
            <button className={btn.primary} onClick={() => setPulling(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className={toolbar}>
        <h2>Packs</h2>
        <button className={btn.primary} onClick={() => setEditing('new')}>
          + Add pack
        </button>
      </div>
      {/* Capped on wide screens so the help text keeps a readable line length. */}
      <p className={`${note} md:max-w-[90ch]`}>
        When a pack rotates in, copy its cost and odds from the in-game info screen. When you buy one, tap <b>I bought one</b>. Store items level up their card automatically; for random packs, tap + on whatever you pulled.
      </p>

      <SeasonBar />
      <ShopSuggestions onAdd={setEditing} />

      {/* From md the Sort control shares a row with the heading of the list it sorts (select stays first for tab order).
          No classes below md, so margins collapse through the wrapper as before. */}
      <div className="md:flex md:flex-row-reverse md:items-center md:gap-2">
        {state.packs.length > 1 && (
          <label className="flex items-center justify-end gap-2 my-[0.4rem]">
            <span className={note}>Sort</span>
            <select value={sortBy} onChange={(e) => chooseSort(e.target.value as SortBy)}>
              <option value="ending">Ending soonest</option>
              <option value="currency">Currency</option>
            </select>
          </label>
        )}
        {groups.active.length > 0 && <h3 className="md:my-[0.4rem] md:mr-auto">Available now</h3>}
      </div>
      {renderGroup(groups.active)}
      {groups.upcoming.length > 0 && <h3>Coming up</h3>}
      {renderGroup(groups.upcoming)}
      {groups.expired.length > 0 && (
        <div className={toolbar}>
          <button className={btn.ghost} onClick={() => setShowExpired(!showExpired)}>
            {showExpired ? '▾' : '▸'} Expired ({groups.expired.length})
          </button>
          <ConfirmButton
            label="Clear expired"
            onConfirm={() =>
              update((d) => void (d.packs = d.packs.filter((p) => packStatus(p, now) !== 'expired')), `Cleared ${groups.expired.length} expired packs`)
            }
          />
        </div>
      )}
      {showExpired && renderGroup(groups.expired)}
      {state.packs.length === 0 && <p className="text-muted">No packs yet.</p>}

      {editing && <PackEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * The current Realm Klash season, shown once there's a season date or a Blood Ruby pack. When MK Mobile Base's
 * schedule covers today, its date is used (App keeps the saved date in step) and can't be edited here.
 * Otherwise seasons are assumed to run 2 weeks; one can end early (an interim season while an app update is
 * delayed), so it can be ended now or corrected.
 */
function SeasonBar() {
  const { state, update } = useStore();
  const now = useNow();
  const events = useEvents();
  const end = seasonEnd(state.realmKlashSeasonEnd, now);
  const scheduled = scheduledSeasonEnd(events, now);
  if (!end && !scheduled && !state.packs.some((p) => p.currencyId === REALM_KLASH_CURRENCY)) return null;
  const seasonalNow = state.packs.filter((p) => p.season && p.endsAt === end).length;
  const leaving = `${seasonalNow} seasonal item${seasonalNow === 1 ? '' : 's'} leave${seasonalNow === 1 ? 's' : ''} then.`;
  if (scheduled) {
    return (
      <div className={card}>
        <div className={`${row} items-center`}>
          {/* On wide screens the date follows its label rather than sitting at the far edge. */}
          <span className={`${grow} md:flex-none`}>Realm Klash season ends</span>
          <b>{new Date(scheduled).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b>
        </div>
        <p className={note}>{leaving} Date from MK Mobile Base's event schedule, refreshed daily.</p>
      </div>
    );
  }
  return (
    <div className={card}>
      <div className={`${row} flex-wrap items-end`}>
        {/* A date doesn't need the full width of a desktop page. */}
        <label className={`${field} flex-1 min-w-0 md:flex-none md:w-[18rem]`}>
          <span>Realm Klash season ends</span>
          <input type="datetime-local" value={end ?? ''} onChange={(e) => e.target.value && update((d) => moveSeasonEnd(d, e.target.value, now))} />
        </label>
        {end && (
          <ConfirmButton
            label="Ended early"
            onConfirm={() => update((d) => moveSeasonEnd(d, toLocalInput(now), now), 'Ended the Realm Klash season early')}
          />
        )}
      </div>
      <p className={note}>
        {end
          ? `${leaving} Each season after is assumed to end 2 weeks later. If a season ends early, tap Ended early; if the new one's timer is different, change the date.`
          : 'Enter when the current season ends (from the in-game timer) so seasonal Blood Ruby items know when they leave.'}
      </p>
    </div>
  );
}

/**
 * Shop packs from MK Mobile Base's schedule that aren't in the app yet. Add opens the pack editor with everything
 * but the drop rates filled in; Not needed hides a pack for good (for packs with no cards you still need).
 */
function ShopSuggestions({ onAdd }: { onAdd: (p: Pack) => void }) {
  const { state, update } = useStore();
  const now = useNow();
  const events = useEvents();
  const [open, setOpen] = useState(true);
  if (!events) return null;
  const packs = shopSuggestions(events, state, now);
  if (!packs.length) return null;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);
  return (
    <section className={card}>
      <div className={toolbar}>
        <button className={btn.ghost} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} In the shop ({packs.length})
        </button>
      </div>
      {open && (
        <>
          <p className={`${note} md:max-w-[90ch]`}>
            From MK Mobile Base's event schedule. It doesn't have drop rates, so <b>Add</b> fills in the rest and you enter the odds for cards you need.
            Packs with nothing you need: <b>Not needed</b> hides them for good.
          </p>
          {/* Two columns from xl (1280px), where each column is wide enough for a one-line title; there every row gets its
              divider, so both columns start with one under the text. */}
          <div className="xl:grid xl:grid-cols-2 xl:gap-x-8">
            {packs.map((sp) => {
              const upcoming = sp.start && new Date(sp.start) > now;
              return (
                <div key={sp.name} className={`${row} items-center xl:border-t xl:border-line`}>
                  {sp.image && <img className={thumb} src={sp.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 44, height: 44 }} />}
                  <div className={grow}>
                    <div className={rowTitle}>{packName(sp)}</div>
                    <div className={note}>
                      {sp.cost != null && `${fmt(sp.cost)} ${sp.currency} · `}
                      {sp.limit != null ? `limit ${sp.limit}` : 'no limit'}
                      {upcoming ? ` · starts ${when(sp.start)}` : sp.end ? ` · ends ${when(sp.end)}` : ' · permanent'}
                    </div>
                  </div>
                  <button onClick={() => onAdd(packFromShop(sp, state, newId()))}>Add</button>
                  <button
                    className={btn.ghost}
                    onClick={() => update((d) => void (d.dismissedShopPacks = [...(d.dismissedShopPacks ?? []), sp.name]), `Hid ${packName(sp)}`)}
                  >
                    Not needed
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
