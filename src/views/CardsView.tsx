import { useMemo, useState } from 'react';
import { newId, useStore } from '../store';
import { buildCtx, cardPriority, copiesToMax, copiesToThreshold, isMaxed, levelLabel, maxFusion, stepCopy, targetLevel } from '../engine';
import { ConfirmButton, LevelOptions, RarityBadge, TIER_LABEL } from '../ui';
import TowersPanel from './TowersPanel';
import type { Card, RarityRule, Tier } from '../types';

type Source = NonNullable<Card['source']> | '';

function SourceSelect({ value, onChange }: { value: Card['source']; onChange: (v: Card['source']) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange((e.target.value as Source) || undefined)} aria-label="Source">
      <option value="">From packs/store</option>
      <option value="krypt">Krypt gear</option>
      <option value="tower">Tower gear</option>
    </select>
  );
}

const TIERS: Tier[] = ['must', 'want', 'nice', 'skip'];

/** Ascension cap choices for rarities that ascend past their fusion levels (e.g. gold: A5 or A10). */
function CapSelect({ rule, value, onChange }: { rule: RarityRule; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const max = maxFusion(rule);
  if (max <= rule.fusionMax) return null;
  return (
    <label className="check">
      Max
      <select value={value ?? max} onChange={(e) => onChange(Number(e.target.value) === max ? null : Number(e.target.value))}>
        <LevelOptions rule={rule} from={rule.fusionMax} />
      </select>
    </label>
  );
}

export default function CardsView() {
  const [sub, setSub] = useState<'cards' | 'towers'>('cards');
  return (
    <>
      <div className="segmented">
        <button className={sub === 'cards' ? 'active' : ''} onClick={() => setSub('cards')}>
          Cards
        </button>
        <button className={sub === 'towers' ? 'active' : ''} onClick={() => setSub('towers')}>
          Tower gear
        </button>
      </div>
      {sub === 'cards' ? <CardList /> : <TowersPanel />}
    </>
  );
}

function CardList() {
  const { state, update } = useStore();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const [rarity, setRarity] = useState<string>('all');
  const [q, setQ] = useState('');
  const [hideMaxed, setHideMaxed] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<Source | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Card, 'id'>>({ name: '', rarityId: state.rarities[0]?.id ?? '', fusion: 0, maxLevel: null, tier: 'want', guest: false });

  const draftRule = ctx.rules.get(draft.rarityId) ?? state.rarities[0];

  const patch = (id: string, p: Partial<Card>) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id);
      if (c) Object.assign(c, p);
    });

  function add() {
    if (!draft.name.trim()) return;
    const isEquip = draftRule?.kind === 'equipment';
    update((d) =>
      void d.cards.push({ id: newId(), ...draft, name: draft.name.trim(), guest: !!draftRule?.hasGuests && draft.guest, source: isEquip ? draft.source : undefined }),
    );
    setDraft({ ...draft, name: '', fusion: 0, guest: false });
  }

  const cards = state.cards
    .filter((c) => rarity === 'all' || c.rarityId === rarity)
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => sourceFilter === 'all' || (c.source ?? '') === sourceFilter)
    .filter((c) => {
      const r = ctx.rules.get(c.rarityId);
      return !hideMaxed || !r || !isMaxed(c, r);
    })
    .sort((a, b) => cardPriority(state, b) - cardPriority(state, a) || a.name.localeCompare(b.name));

  const hiddenMaxed = hideMaxed ? state.cards.filter((c) => ctx.rules.has(c.rarityId) && isMaxed(c, ctx.rules.get(c.rarityId)!)).length : 0;

  return (
    <>
      <section className="card">
        <h2>Add card</h2>
        <div className="form">
          <label className="field wide">
            <span>Name</span>
            <input value={draft.name} placeholder="e.g. Klassic Sub-Zero" onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <label className="field">
            <span>Rarity</span>
            <select value={draft.rarityId} onChange={(e) => setDraft({ ...draft, rarityId: e.target.value, fusion: 0, maxLevel: null })}>
              {state.rarities.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Current level</span>
            <select value={draft.fusion} onChange={(e) => setDraft({ ...draft, fusion: Number(e.target.value) })}>
              <LevelOptions rule={draftRule} />
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value as Tier })}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {draftRule && <CapSelect rule={draftRule} value={draft.maxLevel} onChange={(v) => setDraft({ ...draft, maxLevel: v })} />}
          {draftRule?.hasGuests && (
            <label className="check">
              <input type="checkbox" checked={draft.guest} onChange={(e) => setDraft({ ...draft, guest: e.target.checked })} />
              Guest card
            </label>
          )}
          {draftRule?.kind === 'equipment' && (
            <label className="field">
              <span>Source</span>
              <SourceSelect value={draft.source} onChange={(v) => setDraft({ ...draft, source: v })} />
            </label>
          )}
          <button className="primary" onClick={add} disabled={!draft.name.trim()}>
            Add
          </button>
        </div>
        {draftRule?.goal === 'threshold' && (
          <p className="muted small">
            {draftRule.label} is tracked only until F{draftRule.fusionUpThreshold}. After that, your Fusion Up Kards can max it.
          </p>
        )}
      </section>

      <div className="filters">
        <input className="grow" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="all">All rarities</option>
          {state.rarities.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as Source | 'all')} aria-label="Filter by source">
          <option value="all">Any source</option>
          <option value="">Packs/store</option>
          <option value="krypt">Krypt gear</option>
          <option value="tower">Tower gear</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={hideMaxed} onChange={(e) => setHideMaxed(e.target.checked)} />
          Hide done{hiddenMaxed > 0 && ` (${hiddenMaxed})`}
        </label>
      </div>

      {cards.length === 0 && <p className="muted">No cards match.</p>}
      {cards.map((c) => {
        const rule = ctx.rules.get(c.rarityId);
        if (!rule) return null;
        const max = maxFusion(rule);
        const target = targetLevel(c, rule);
        const toThr = copiesToThreshold(c, rule);
        const toMax = copiesToMax(c, rule);
        const kards = ctx.kardCopies.get(c.id) ?? 0;
        return (
          <div key={c.id} className="card card-row">
            <div className="row">
              <div className="grow">
                {editingId === c.id ? (
                  <input value={c.name} autoFocus onChange={(e) => patch(c.id, { name: e.target.value })} onBlur={() => setEditingId(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)} />
                ) : (
                  <div className="row-title" onClick={() => setEditingId(c.id)} title="Tap to rename">
                    {c.name}
                  </div>
                )}
                <div className="small">
                  <RarityBadge rule={rule} />
                  {c.guest && <span className="chip guest">guest</span>}
                  {c.source && <span className="chip krypt">{c.source}{c.sourceNote && `: ${c.sourceNote}`}</span>}
                  {toMax === 0 ? (
                    <span className="chip maxed">{rule.goal === 'threshold' ? `F${rule.fusionUpThreshold}, Kards can finish it` : 'maxed'}</span>
                  ) : (
                    <>
                      {toThr > 0 && rule.fusionUpThreshold! < target && <span className="chip phase-toThreshold">{toThr} to F{rule.fusionUpThreshold}</span>}
                      <span className={`chip ${rule.goal === 'threshold' ? 'phase-toThreshold' : 'muted'}`}>
                        {toMax} to {levelLabel(rule, target)}
                      </span>
                      {kards > 0 && <span className="chip phase-kardCovered">kards give {kards}</span>}
                    </>
                  )}
                </div>
              </div>
              <div className="stepper">
                <button onClick={() => patch(c.id, stepCopy(c, rule, -1))} disabled={c.fusion <= 0} aria-label="Remove a copy">
                  −
                </button>
                <span className="stepper-val" title={c.spare ? `${c.spare} dupe(s) toward the next level` : undefined}>
                  {c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}
                  {!!c.spare && <small>+{c.spare}</small>}
                </span>
                <button onClick={() => patch(c.id, stepCopy(c, rule, 1))} disabled={c.fusion >= max} aria-label="Add a copy">
                  +
                </button>
              </div>
            </div>
            <div className="actions">
              <select value={c.tier} onChange={(e) => patch(c.id, { tier: e.target.value as Tier })}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </select>
              <CapSelect rule={rule} value={c.maxLevel} onChange={(v) => patch(c.id, { maxLevel: v })} />
              {rule.hasGuests && (
                <label className="check">
                  <input type="checkbox" checked={c.guest} onChange={(e) => patch(c.id, { guest: e.target.checked })} />
                  Guest
                </label>
              )}
              {rule.kind === 'equipment' && <SourceSelect value={c.source} onChange={(v) => patch(c.id, { source: v })} />}
              <ConfirmButton
                label="Delete"
                className="ghost"
                onConfirm={() =>
                  update((d) => {
                    d.cards = d.cards.filter((x) => x.id !== c.id);
                    for (const p of d.packs) p.drops = p.drops.filter((x) => x.cardId !== c.id);
                  })
                }
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
