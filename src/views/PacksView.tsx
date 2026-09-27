import { useState } from 'react';
import { newId, useStore } from '../store';
import { levelLabel, maxFusion, packStatus, urgency } from '../engine';
import { CardThumb, ConfirmButton, fmt, useNow } from '../ui';
import { PackTiming } from './PlanView';
import PackEditor from './PackEditor';
import type { AppState, Pack } from '../types';

export default function PacksView() {
  const { state, update } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState<Pack | 'new' | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  /** Random pack just bought: show its drop list so pulled cards can be levelled up in place. */
  const [pulling, setPulling] = useState<string | null>(null);
  const rules = new Map(state.rarities.map((r) => [r.id, r]));
  const curName = (id: string) => state.currencies.find((c) => c.id === id)?.name ?? id;
  const cardName = (id: string) => state.cards.find((c) => c.id === id)?.name ?? '(deleted card)';

  const groups = { active: [] as Pack[], upcoming: [] as Pack[], expired: [] as Pack[] };
  for (const p of state.packs) groups[packStatus(p, now)].push(p);
  for (const g of Object.values(groups)) g.sort((a, b) => urgency(a) - urgency(b));

  /** Level a card up or down by one copy, within its rarity's range. */
  const stepCard = (d: AppState, cardId: string, delta: 1 | -1) => {
    const card = d.cards.find((c) => c.id === cardId);
    const rule = card && d.rarities.find((r) => r.id === card.rarityId);
    if (card && rule) card.fusion = Math.min(maxFusion(rule), Math.max(0, card.fusion + delta));
  };

  // Store items give a known card, so buying one levels it up; for random packs we ask what was pulled.
  const buy = (p: Pack, delta: 1 | -1) => {
    update((d) => {
      const pack = d.packs.find((x) => x.id === p.id)!;
      if (delta < 0 && pack.purchased <= 0) return;
      pack.purchased += delta;
      const cur = d.currencies.find((c) => c.id === pack.currencyId);
      if (cur) cur.balance = Math.max(0, cur.balance - delta * pack.cost);
      if (pack.store && pack.drops[0]) stepCard(d, pack.drops[0].cardId, delta);
    }, delta > 0 ? `Bought ${p.name}` : undefined);
    if (!p.store) setPulling(delta > 0 ? p.id : null);
  };

  const duplicate = (p: Pack) => setEditing({ ...structuredClone(p), id: newId(), name: `${p.name} (rerun)`, purchased: 0, startsAt: null, endsAt: null });

  const renderPack = (p: Pack) => (
    <div key={p.id} className="card pack">
      <div className="row">
        <div className="grow">
          <div className="row-title">{p.name}</div>
          <div className="muted small">
            {fmt(p.cost)} {curName(p.currencyId)}
            {p.store && ' · store item'}
            {p.rolls > 1 && ` · ${p.rolls} cards per buy`} · bought {p.purchased}
            {p.maxPurchases != null && `/${p.maxPurchases}`}
          </div>
        </div>
        <PackTiming pack={p} now={now} />
      </div>
      <div className="drops">
        {p.drops.map((d, i) => (
          <span key={i} className="drop">
            {cardName(d.cardId)} <b>{d.chance}%</b>
          </span>
        ))}
        {p.drops.length === 0 && <span className="muted small">No drops entered yet.</span>}
      </div>
      <div className="actions">
        {packStatus(p, now) === 'active' && (
          <>
            <button
              className="primary"
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
        <div className="subpanel">
          <div className="small">
            <b>What did you pull?</b> <span className="muted">Tap + for each copy you got. Cards you don't track can be ignored.</span>
          </div>
          {p.drops.map((d) => {
            const card = state.cards.find((c) => c.id === d.cardId);
            const rule = card && rules.get(card.rarityId);
            if (!card || !rule) return null;
            return (
              <div key={d.cardId} className="row">
                <CardThumb card={card} rule={rule} size={36} />
                <span className="grow">{card.name}</span>
                <div className="stepper">
                  <button onClick={() => update((s) => stepCard(s, card.id, -1))} disabled={card.fusion <= 0} aria-label="Remove a copy">
                    −
                  </button>
                  <span className="stepper-val">{card.fusion === 0 ? '—' : levelLabel(rule, card.fusion)}</span>
                  <button onClick={() => update((s) => stepCard(s, card.id, 1))} disabled={card.fusion >= maxFusion(rule)} aria-label="Add a copy">
                    +
                  </button>
                </div>
              </div>
            );
          })}
          <div className="actions">
            <button className="primary" onClick={() => setPulling(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <h2>Packs</h2>
        <button className="primary" onClick={() => setEditing('new')}>
          + Add pack
        </button>
      </div>
      <p className="muted small">
        When a pack rotates in, copy its cost and odds from the in-game info screen. When you buy one, tap <b>I bought one</b>. Store items level up their card automatically; for random packs, tap + on whatever you pulled.
      </p>

      {groups.active.length > 0 && <h3>Available now</h3>}
      {groups.active.map(renderPack)}
      {groups.upcoming.length > 0 && <h3>Coming up</h3>}
      {groups.upcoming.map(renderPack)}
      {groups.expired.length > 0 && (
        <div className="toolbar">
          <button className="ghost" onClick={() => setShowExpired(!showExpired)}>
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
      {showExpired && groups.expired.map(renderPack)}
      {state.packs.length === 0 && <p className="muted">No packs yet.</p>}

      {editing && <PackEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
