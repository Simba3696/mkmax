import { useMemo, useState } from 'react';
import { newId, useStore } from '../store';
import { buildCtx, cardPriority, copiesToMax, copiesToThreshold, fLevel, levelLabel, maxFusion, targetLevel, thresholdLevel } from '../engine';
import { CardThumb, ConfirmButton, LevelOptions, RarityBadge, TIER_LABEL } from '../ui';
import TowersPanel from './TowersPanel';
import { findCardImages, wikiUrl } from '../wiki';
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
  const fusionTop = fLevel(rule.fusionMax);
  if (max <= fusionTop) return null;
  return (
    <label className="check">
      Max
      <select value={value ?? max} onChange={(e) => onChange(Number(e.target.value) === max ? null : Number(e.target.value))}>
        <LevelOptions rule={rule} from={fusionTop} />
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
  const [sourceFilter, setSourceFilter] = useState<Source | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageEditId, setImageEditId] = useState<string | null>(null);
  const [imgStatus, setImgStatus] = useState<{ busy: boolean; msg: string } | null>(null);
  const [draft, setDraft] = useState<Omit<Card, 'id'>>({ name: '', rarityId: state.rarities[0]?.id ?? '', fusion: 0, maxLevel: null, tier: 'want', guest: false });

  const draftRule = ctx.rules.get(draft.rarityId) ?? state.rarities[0];
  const missingImages = state.cards.filter((c) => !c.imageUrl);

  async function findImages() {
    setImgStatus({ busy: true, msg: 'Starting…' });
    try {
      const found = await findCardImages(missingImages, ctx.rules, (msg) => setImgStatus({ busy: true, msg }));
      update((d) => {
        for (const c of d.cards) {
          const m = found.get(c.id);
          if (m) Object.assign(c, m);
        }
      });
      const left = missingImages.length - found.size;
      setImgStatus({ busy: false, msg: `Found ${found.size} of ${missingImages.length}.${left ? ` ${left} not on the wiki: open "Image" on those cards to paste a URL.` : ''}` });
    } catch (e) {
      setImgStatus({ busy: false, msg: `Couldn't reach the wiki: ${(e as Error).message}` });
    }
  }

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
    .sort((a, b) => cardPriority(state, b) - cardPriority(state, a) || a.name.localeCompare(b.name));

  return (
    <>
      <section className="card">
        <h2>Add card</h2>
        <div className="form">
          <label className="field wide">
            <span>Name</span>
            <input value={draft.name} placeholder="e.g. Sub-Zero, Klassic (name, variant)" onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
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
        {missingImages.length > 0 && (
          <button onClick={findImages} disabled={imgStatus?.busy} title="Look up card art on the MK Mobile wiki">
            {imgStatus?.busy ? 'Finding…' : `Find images (${missingImages.length})`}
          </button>
        )}
      </div>
      {imgStatus && <p className="small muted">{imgStatus.msg}</p>}

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
              <CardThumb card={c} rule={rule} />
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
                  {/* Cards that reach their goal are removed, so every card listed still has copies to go. */}
                  {toThr > 0 && thresholdLevel(rule)! < target && <span className="chip phase-toThreshold">{toThr} to F{rule.fusionUpThreshold}</span>}
                  <span className={`chip ${rule.goal === 'threshold' ? 'phase-toThreshold' : 'muted'}`}>
                    {toMax} to {levelLabel(rule, target)}
                  </span>
                  {kards > 0 && <span className="chip phase-kardCovered">kards give {kards}</span>}
                </div>
              </div>
              <div className="stepper">
                <button onClick={() => patch(c.id, { fusion: Math.max(0, c.fusion - 1) })} disabled={c.fusion <= 0} aria-label="Lower level">
                  −
                </button>
                <span className="stepper-val">{c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}</span>
                <button onClick={() => patch(c.id, { fusion: Math.min(max, c.fusion + 1) })} disabled={c.fusion >= max} aria-label="Raise level">
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
              <button className="ghost" onClick={() => setImageEditId(imageEditId === c.id ? null : c.id)}>
                Image
              </button>
              <ConfirmButton
                label="Delete"
                className="ghost"
                onConfirm={() =>
                  update((d) => {
                    d.cards = d.cards.filter((x) => x.id !== c.id);
                    for (const p of d.packs) p.drops = p.drops.filter((x) => x.cardId !== c.id);
                  }, `Deleted ${c.name}`)
                }
              />
            </div>
            {imageEditId === c.id && (
              <div className="drop-row wrap">
                <input
                  className="grow"
                  value={c.imageUrl ?? ''}
                  placeholder="Paste an image URL"
                  onChange={(e) => patch(c.id, { imageUrl: e.target.value.trim() || undefined, wikiTitle: undefined })}
                />
                {c.wikiTitle && (
                  <a className="small" href={wikiUrl(c.wikiTitle)} target="_blank" rel="noreferrer">
                    Wiki page
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
