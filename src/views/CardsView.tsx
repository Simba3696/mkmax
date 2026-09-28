import { useMemo, useState } from 'react';
import { newId, useStore } from '../store';
import { buildCtx, cardGoal, copiesToMax, copiesToThreshold, fLevel, levelLabel, maxFusion, targetLevel, thresholdLevel } from '../engine';
import { CardThumb, ConfirmButton, LevelOptions, RarityBadge, useBrokenImageUrls } from '../ui';
import TowersPanel from './TowersPanel';
import { findCardImages, wikiUrl } from '../wiki';
import { appRarityId, catalogPageUrl, findInCatalog, loadCatalog } from '../catalog';
import type { Card, RarityRule } from '../types';

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

/**
 * Goal for rarities with a Fusion Up Kard threshold: stop at the threshold (kards finish it) or buy all the way
 * to max (e.g. Realm Klash epics). Stored only when it differs from the rarity's goal.
 */
function GoalSelect({ rule, value, onChange }: { rule: RarityRule; value: Card['goal']; onChange: (v: Card['goal']) => void }) {
  // Only equipment switches between "F3, Kards finish it" and buying to max; characters are always maxed.
  if (rule.kind !== 'equipment' || rule.fusionUpThreshold == null) return null;
  const current = value ?? rule.goal;
  return (
    <label className="check">
      Goal
      <select value={current} onChange={(e) => onChange(e.target.value === rule.goal ? undefined : (e.target.value as Card['goal']))}>
        <option value="threshold">F{rule.fusionUpThreshold} (Kards finish it)</option>
        <option value="max">Max ({levelLabel(rule, maxFusion(rule))})</option>
      </select>
    </label>
  );
}

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
  /** Cards whose rarity disagrees with mkmobilebase, from the last Find images run. */
  const [rarityFixes, setRarityFixes] = useState<{ cardId: string; name: string; from: string; to: string }[]>([]);
  const [draft, setDraft] = useState<Omit<Card, 'id'>>({ name: '', rarityId: state.rarities[0]?.id ?? '', fusion: 0, maxLevel: null, guest: false });

  const draftRule = ctx.rules.get(draft.rarityId) ?? state.rarities[0];
  // Cards to look up: no art yet, art that stopped loading, or art from an older wiki lookup (some of those are
  // stat screenshots rather than card art), which mkmobilebase usually has a proper card image for.
  const brokenUrls = useBrokenImageUrls();
  const needsImage = (c: Card) => !c.imageUrl || brokenUrls.has(c.imageUrl) || (!!c.wikiTitle && !c.imagePage);
  const missingImages = state.cards.filter(needsImage);

  async function findImages() {
    setImgStatus({ busy: true, msg: 'Checking the MK Mobile Base catalog…' });
    try {
      const items = await loadCatalog();
      const found = new Map<string, Pick<Card, 'imageUrl' | 'wikiTitle' | 'imagePage'>>();
      for (const c of missingImages) {
        const hit = findInCatalog(c, ctx.rules.get(c.rarityId), items);
        if (hit) found.set(c.id, { imageUrl: hit.image, wikiTitle: undefined, imagePage: catalogPageUrl(hit) });
      }
      // Anything the catalog doesn't have: fall back to the wiki (only for cards with no working image).
      const rest = missingImages.filter((c) => !found.has(c.id) && (!c.imageUrl || brokenUrls.has(c.imageUrl)));
      if (rest.length) {
        const fromWiki = await findCardImages(rest, ctx.rules, (msg) => setImgStatus({ busy: true, msg }));
        for (const [id, m] of fromWiki) found.set(id, { ...m, imagePage: wikiUrl(m.wikiTitle) });
      }
      // Older wiki images the catalog couldn't improve on: remember they were checked so they stop counting.
      const keep = missingImages.filter((c) => !found.has(c.id) && c.imageUrl && !brokenUrls.has(c.imageUrl) && c.wikiTitle);
      update((d) => {
        for (const c of d.cards) {
          const m = found.get(c.id);
          if (m) Object.assign(c, m);
          else if (keep.some((k) => k.id === c.id)) c.imagePage = wikiUrl(c.wikiTitle!);
        }
      });
      setRarityFixes(
        state.cards.flatMap((c) => {
          const hit = findInCatalog(c, ctx.rules.get(c.rarityId), items);
          // appRarityId stays within the card's kind: a "Diamond" Kameo on the site maps to Diamond Kameo, not Diamond.
          const to = hit && appRarityId(hit, ctx.rules.values());
          return to && to !== c.rarityId
            ? [{ cardId: c.id, name: c.name, from: ctx.rules.get(c.rarityId)?.label ?? c.rarityId, to }]
            : [];
        }),
      );
      const left = missingImages.filter((c) => !found.has(c.id) && (!c.imageUrl || brokenUrls.has(c.imageUrl))).length;
      setImgStatus({ busy: false, msg: `Updated ${found.size} of ${missingImages.length}.${left ? ` ${left} not found online: open "Image" on those cards to paste a URL.` : ''}` });
    } catch (e) {
      setImgStatus({ busy: false, msg: `Couldn't look up images: ${(e as Error).message}` });
    }
  }

  function applyRarityFixes() {
    update((d) => {
      for (const f of rarityFixes) {
        const c = d.cards.find((x) => x.id === f.cardId);
        if (c) c.rarityId = f.to;
      }
    }, `rarity change for ${rarityFixes.length} card${rarityFixes.length === 1 ? '' : 's'}`);
    setRarityFixes([]);
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

  const rarityOrder = (c: Card) => state.rarities.findIndex((r) => r.id === c.rarityId);
  const cards = state.cards
    .filter((c) => rarity === 'all' || c.rarityId === rarity)
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => sourceFilter === 'all' || (c.source ?? '') === sourceFilter)
    // Stable order (rarity, then name) so a card doesn't jump around while you edit it.
    .sort((a, b) => rarityOrder(a) - rarityOrder(b) || a.name.localeCompare(b.name));

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
          {/* Kameos are only tracked until you own one, so a new one is always "not owned": no level to pick. */}
          {draftRule && maxFusion(draftRule) > 1 && (
            <label className="field">
              <span>Current level</span>
              <select value={draft.fusion} onChange={(e) => setDraft({ ...draft, fusion: Number(e.target.value) })}>
                <LevelOptions rule={draftRule} />
              </select>
            </label>
          )}
          {draftRule && <GoalSelect rule={draftRule} value={draft.goal} onChange={(v) => setDraft({ ...draft, goal: v })} />}
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
        {draftRule && cardGoal(draft as Card, draftRule) === 'threshold' && (
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
          <button onClick={findImages} disabled={imgStatus?.busy} title="Look up card art on MK Mobile Base, then the MK Mobile wiki">
            {imgStatus?.busy ? 'Finding…' : `Find images (${missingImages.length})`}
          </button>
        )}
      </div>
      {imgStatus && <p className="small muted">{imgStatus.msg}</p>}
      {rarityFixes.length > 0 && (
        <div className="hint">
          <p>MK Mobile Base lists a different rarity for {rarityFixes.length === 1 ? 'this card' : 'these cards'}:</p>
          <ul className="small">
            {rarityFixes.map((f) => (
              <li key={f.cardId}>
                {f.name}: {f.from} here, <b>{ctx.rules.get(f.to)?.label ?? f.to}</b> on the site
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="primary" onClick={applyRarityFixes}>
              Use the site's rarity
            </button>
            <button className="ghost" onClick={() => setRarityFixes([])}>
              Keep mine
            </button>
          </div>
        </div>
      )}

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
                  <span className={`chip ${cardGoal(c, rule) === 'threshold' ? 'phase-toThreshold' : 'muted'}`}>
                    {maxFusion(rule) === 1 ? 'Not owned yet' : `${toMax} to ${levelLabel(rule, target)}`}
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
              <GoalSelect rule={rule} value={c.goal} onChange={(v) => patch(c.id, { goal: v })} />
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
                  onChange={(e) => patch(c.id, { imageUrl: e.target.value.trim() || undefined, wikiTitle: undefined, imagePage: undefined })}
                />
                {(c.imagePage || c.wikiTitle) && (
                  <a className="small" href={c.imagePage ?? wikiUrl(c.wikiTitle!)} target="_blank" rel="noreferrer">
                    {(c.imagePage ?? '').includes('mkmobilebase') ? 'MK Mobile Base page' : 'Wiki page'}
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
