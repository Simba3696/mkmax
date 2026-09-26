import { useState } from 'react';
import { newId, useStore } from '../store';
import { packStatus, urgency } from '../engine';
import { ConfirmButton, fmt, useNow } from '../ui';
import { PackTiming } from './PlanView';
import PackEditor from './PackEditor';
import type { Pack } from '../types';

export default function PacksView() {
  const { state, update } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState<Pack | 'new' | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const curName = (id: string) => state.currencies.find((c) => c.id === id)?.name ?? id;
  const cardName = (id: string) => state.cards.find((c) => c.id === id)?.name ?? '(deleted card)';

  const groups = { active: [] as Pack[], upcoming: [] as Pack[], expired: [] as Pack[] };
  for (const p of state.packs) groups[packStatus(p, now)].push(p);
  for (const g of Object.values(groups)) g.sort((a, b) => urgency(a) - urgency(b));

  const buy = (p: Pack, delta: 1 | -1) =>
    update((d) => {
      const pack = d.packs.find((x) => x.id === p.id)!;
      if (delta < 0 && pack.purchased <= 0) return;
      pack.purchased += delta;
      const cur = d.currencies.find((c) => c.id === pack.currencyId);
      if (cur) cur.balance = Math.max(0, cur.balance - delta * pack.cost);
    });

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
              title="Adds a purchase and deducts the cost from your balance"
            >
              I bought one
            </button>
            {p.purchased > 0 && <button onClick={() => buy(p, -1)}>Undo</button>}
          </>
        )}
        <button onClick={() => setEditing(p)}>Edit</button>
        <button onClick={() => duplicate(p)}>Rerun</button>
        <ConfirmButton label="Delete" onConfirm={() => update((d) => void (d.packs = d.packs.filter((x) => x.id !== p.id)))} />
      </div>
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
        When a pack rotates in, copy its cost and odds from the in-game info screen. After you buy one, tap <b>I bought one</b>, then update the fusion on the cards you pulled.
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
            onConfirm={() => update((d) => void (d.packs = d.packs.filter((p) => packStatus(p, now) !== 'expired')))}
          />
        </div>
      )}
      {showExpired && groups.expired.map(renderPack)}
      {state.packs.length === 0 && <p className="muted">No packs yet.</p>}

      {editing && <PackEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
