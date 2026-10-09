import { useEffect, useMemo, useState } from 'react';
import { newId, useStore } from '../store';
import { ascensionCaps, buildCtx, cardGoal, copiesToMax, copiesToThreshold, fLevel, fuseWithKards, kardStep, levelLabel, maxFusion, targetLevel, thresholdLevel } from '../engine';
import { CardThumb, Chip, ConfirmButton, LevelOptions, RarityBadge, SOURCE_LABELS, useBrokenImageUrls, useDeviceChoice, useNow } from '../ui';
import { actions, btn, card, check, field, form, grow, hint, row, rowTitle, subpanel, surface, stepper, stepperVal } from '../classes';
import TowersPanel from './TowersPanel';
import { findCardImages, wikiUrl } from '../wiki';
import { catalogPageUrl, findInCatalog, loadCatalog, rarityMismatches, wantsCatalogImage, type CatalogItem } from '../catalog';
import { parseCardList } from '../cardList';
import { applyRarityFix, initialSource } from '../challenges';
import { challengeFor, challengeWhen, useEvents } from '../events';
import type { Card, RarityRule } from '../types';

type Source = NonNullable<Card['source']> | '';

const SOURCE_NAMES: Record<NonNullable<Card['source']>, string> = { krypt: 'Krypt gear', tower: 'Tower gear', challenge: 'Elder challenge' };
const SOURCES_BY_KIND: Record<RarityRule['kind'], NonNullable<Card['source']>[]> = { equipment: ['krypt', 'tower'], kameo: ['challenge'], character: [] };

/**
 * Gear can come from the Krypt or a tower; Kameos from an Elder challenge. A source the card's kind can't have (an
 * older paste could tag a character as Krypt gear) is still listed, so it can be cleared.
 */
function SourceSelect({ kind, value, onChange }: { kind: RarityRule['kind']; value: Card['source']; onChange: (v: Card['source']) => void }) {
  const options = SOURCES_BY_KIND[kind];
  return (
    <select value={value ?? ''} onChange={(e) => onChange((e.target.value as Source) || undefined)} aria-label="Source">
      <option value="">From packs/store</option>
      {value && !options.includes(value) && <option value={value}>{SOURCE_NAMES[value]} (not for this rarity)</option>}
      {options.map((v) => (
        <option key={v} value={v}>
          {SOURCE_NAMES[v]}
        </option>
      ))}
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
  const max = levelLabel(rule, maxFusion(rule));
  // A stored Max marks Realm Klash gear (see isRealmKlashGear) even once the rarity's own goal is Max too, which
  // happens to gear set to Max before its Track until was. Say so, and offer the plain Max that clears the mark.
  const stuck = value === 'max' && rule.goal === 'max';
  return (
    <label className={check}>
      Goal
      <select value={current} onChange={(e) => onChange(e.target.value === rule.goal || e.target.value === 'plain' ? undefined : (e.target.value as Card['goal']))}>
        <option value="threshold">F{rule.fusionUpThreshold} (Kards finish it)</option>
        <option value="max">{`Max (${max}${value === 'max' || rule.goal === 'threshold' ? ', Realm Klash gear' : ''})`}</option>
        {stuck && <option value="plain">{`Max (${max})`}</option>}
      </select>
    </label>
  );
}

/**
 * Cap choices for rarities that ascend past their fusion levels. Gold cards stop at F10 (no ascension), A5 or
 * A10, depending on the card and which updates gave it ascension. The game calls those caps Stage I and Stage II
 * Ascension, and patch notes name characters by stage, so the options say both. Any other saved cap is still
 * shown, flagged.
 */
function CapSelect({ rule, value, onChange }: { rule: RarityRule; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const max = maxFusion(rule);
  const caps = ascensionCaps(rule);
  if (caps.length < 2) return null;
  const current = value ?? max;
  const top = fLevel(rule.fusionMax);
  const label = (l: number) =>
    l === top ? `${levelLabel(rule, l)} (no ascension)` : l === top + 5 ? `${levelLabel(rule, l)} (Stage I)` : l === top + 10 ? `${levelLabel(rule, l)} (Stage II)` : levelLabel(rule, l);
  return (
    <label className={check}>
      Max
      <select value={current} onChange={(e) => onChange(Number(e.target.value) === max ? null : Number(e.target.value))}>
        {!caps.includes(current) && <option value={current}>{levelLabel(rule, current)} (not a real cap)</option>}
        {caps.map((l) => (
          <option key={l} value={l}>
            {label(l)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Add many cards at once from a pasted list, one name per line; rarity headings in the list switch the rarity. */
function PasteList({ startRarityId }: { startRarityId: string }) {
  const { state, update } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseCardList(text, state.rarities, startRarityId, state.cards), [text, state.rarities, startRarityId, state.cards]);
  const counts = state.rarities
    .map((r) => ({ label: r.label, n: parsed.cards.filter((c) => c.rarityId === r.id).length }))
    .filter((x) => x.n > 0);

  if (!open) {
    return (
      <div className={actions}>
        <button onClick={() => setOpen(true)}>Paste a list…</button>
      </div>
    );
  }

  const total = parsed.cards.length + parsed.updates.length;
  function addAll() {
    const label = [parsed.cards.length && `Added ${parsed.cards.length} cards`, parsed.updates.length && `updated ${parsed.updates.length}`].filter(Boolean).join(', ');
    update((d) => {
      d.cards.push(
        ...parsed.cards.map(
          (c): Card => ({
            id: newId(),
            name: c.name,
            rarityId: c.rarityId,
            fusion: c.fusion ?? 0,
            guest: false,
            source: c.source ?? initialSource(c, d.rarities),
            ...(c.sourceNote && { sourceNote: c.sourceNote }),
          }),
        ),
      );
      for (const u of parsed.updates) Object.assign(d.cards.find((c) => c.id === u.cardId) ?? {}, u.patch);
    }, label);
    setText('');
    setOpen(false);
  }

  const startLabel = state.rarities.find((r) => r.id === startRarityId)?.label ?? '';
  return (
    <div className={subpanel}>
      {/* A readable line length; the textarea below still takes the full width. */}
      <p className="text-muted text-small md:max-w-[80ch]">
        One card per line. A line can be just a name, like "Jade, Lizard", which goes in as not owned. Those use {startLabel} (the rarity picked above) until a
        line that's just a rarity name, like "Gold Kameo", switches it. A line can also add details after " - ": rarity, where it comes from and level, like
        "Kori Blade - Epic - Lin Kuei Tower - F2" or "Man in Control - Epic - Krypt Gear - Unowned". Cards already in your list get the new level and source.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Gold Kameo\nJade, Lizard\nKori Blade - Epic - Lin Kuei Tower - F2'} autoFocus />
      <div className="text-small text-muted">
        {counts.length ? `New: ${counts.map((x) => `${x.n} ${x.label}`).join(' · ')}` : parsed.updates.length ? '' : 'Nothing to add yet.'}
        {parsed.updates.length > 0 && ` · updating ${parsed.updates.length} already listed (${parsed.updates.map((u) => u.name).join('; ')})`}
        {parsed.duplicates.length > 0 && ` · skipping ${parsed.duplicates.length} already listed (${parsed.duplicates.join('; ')})`}
      </div>
      {parsed.problems.length > 0 && (
        <ul className="list-disc pl-[40px] my-[1em] text-error text-small">
          {parsed.problems.map((p) => (
            <li key={p.line}>
              Skipped "{p.line}": {p.reason}.
            </li>
          ))}
        </ul>
      )}
      <div className={actions}>
        <button onClick={() => setOpen(false)}>Cancel</button>
        <button className={btn.primary} disabled={!total} onClick={addAll}>
          {parsed.cards.length > 0 && `Add ${parsed.cards.length}`}
          {parsed.cards.length > 0 && parsed.updates.length > 0 && ', '}
          {parsed.updates.length > 0 && `update ${parsed.updates.length}`}
          {!total && 'Add cards'}
        </button>
      </div>
    </div>
  );
}

export default function CardsView() {
  const [sub, setSub] = useState<'cards' | 'towers'>('cards');
  return (
    <>
      {/* A short switch on wide screens: stretched across 1000px+ it reads as a banner, not two buttons. */}
      <div className="flex mb-[0.8rem] border border-line rounded-panel overflow-hidden md:max-w-[360px]">
        <button className={segment(sub === 'cards')} onClick={() => setSub('cards')}>
          Cards
        </button>
        <button className={segment(sub === 'towers')} onClick={() => setSub('towers')}>
          Tower gear
        </button>
      </div>
      {sub === 'cards' ? <CardList /> : <TowersPanel />}
    </>
  );
}

const segment = (active: boolean) => `flex-1 border-0 rounded-none focus-visible:-outline-offset-2 ${active ? 'bg-red-dim text-fg' : 'bg-panel text-muted hover:text-fg'}`;

const CARD_SORTS = ['rarity', 'fusion-high', 'fusion-low', 'name'] as const;
type CardSort = (typeof CARD_SORTS)[number];

function CardList() {
  const { state, update } = useStore();
  const ctx = useMemo(() => buildCtx(state), [state]);
  const events = useEvents();
  const now = useNow();
  const [rarity, setRarity] = useState<string>('all');
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<Source | 'all'>('all');
  const [sortBy, setSortBy] = useDeviceChoice('mkmax:cardSort', CARD_SORTS);
  /**
   * The card being renamed, its name before (which comes back if the name is cleared) and what's in the box. A blank
   * box isn't saved, so a card never syncs with no name.
   */
  const [renaming, setRenaming] = useState<{ id: string; was: string; text: string } | null>(null);
  const [imageEditId, setImageEditId] = useState<string | null>(null);
  const [imgStatus, setImgStatus] = useState<{ busy: boolean; msg: string } | null>(null);
  // Cards get their art as soon as they're added, even under the wrong rarity, so the rarity check runs whenever
  // the catalog is at hand rather than only from Find images.
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(
      (items) => !cancelled && setCatalog(items),
      () => {}, // offline: Find images tries again
    );
    return () => void (cancelled = true);
  }, []);
  const rarityFixes = useMemo(() => (catalog ? rarityMismatches(state.cards, ctx.rules, catalog) : []), [catalog, state.cards, ctx.rules]);
  const [draft, setDraft] = useState<Omit<Card, 'id'>>({ name: '', rarityId: state.rarities[0]?.id ?? '', fusion: 0, maxLevel: null, guest: false });

  const draftRule = ctx.rules.get(draft.rarityId) ?? state.rarities[0];
  // Cards to look up: no art yet, art that stopped loading, or art from an older wiki lookup (some of those are
  // stat screenshots rather than card art), which mkmobilebase usually has a proper card image for.
  const brokenUrls = useBrokenImageUrls();
  const needsImage = (c: Card) => wantsCatalogImage(c) || brokenUrls.has(c.imageUrl!);
  const missingImages = state.cards.filter(needsImage);

  async function findImages() {
    setImgStatus({ busy: true, msg: 'Checking the MK Mobile Base catalog…' });
    try {
      const items = await loadCatalog();
      setCatalog(items);
      const found = new Map<string, Pick<Card, 'imageUrl' | 'wikiTitle' | 'imagePage'>>();
      for (const c of missingImages) {
        const hit = findInCatalog(c, ctx.rules.get(c.rarityId), items);
        if (hit) found.set(c.id, { imageUrl: hit.image, wikiTitle: undefined, imagePage: catalogPageUrl(hit) });
      }
      // Anything the catalog doesn't have: fall back to the wiki (only for cards with no working image).
      const rest = missingImages.filter((c) => !found.has(c.id) && (!c.imageUrl || brokenUrls.has(c.imageUrl)));
      // A wiki that's down or offline still leaves the catalog's art to save.
      let wikiError: string | undefined;
      if (rest.length) {
        try {
          const fromWiki = await findCardImages(rest, ctx.rules, (msg) => setImgStatus({ busy: true, msg }));
          for (const [id, m] of fromWiki) found.set(id, { ...m, imagePage: wikiUrl(m.wikiTitle) });
        } catch (e) {
          wikiError = (e as Error).message;
        }
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
      const left = missingImages.filter((c) => !found.has(c.id) && (!c.imageUrl || brokenUrls.has(c.imageUrl))).length;
      const leftMsg = !left
        ? ''
        : wikiError
          ? ` Couldn't reach the MK Mobile wiki (${wikiError}), so ${left} weren't looked up there. Try again later.`
          : ` ${left} not found online: open "Image" on those cards to paste a URL.`;
      setImgStatus({ busy: false, msg: `Updated ${found.size} of ${missingImages.length}.${leftMsg}` });
    } catch (e) {
      setImgStatus({ busy: false, msg: `Couldn't look up images: ${(e as Error).message}` });
    }
  }

  const cardCount = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  const whichCards = (fixes: typeof rarityFixes) => (fixes.length === 1 ? fixes[0].card.name : cardCount(fixes.length));
  function applyRarityFixes(fixes: typeof rarityFixes) {
    update((d) => {
      for (const f of fixes) {
        const c = d.cards.find((x) => x.id === f.card.id);
        if (c) applyRarityFix(c, f.to, d.rarities);
      }
    }, `Changed the rarity of ${whichCards(fixes)}`);
  }

  function keepRarities(fixes: typeof rarityFixes) {
    update((d) => {
      for (const f of fixes) {
        const c = d.cards.find((x) => x.id === f.card.id);
        if (c) c.keptRarity = f.to;
      }
    }, `Kept your rarity for ${whichCards(fixes)}`);
  }

  // Brings a kept card back into the rarity check, in case Keep mine was the wrong choice.
  const askRarityAgain = (c: Card) =>
    update((d) => {
      const x = d.cards.find((y) => y.id === c.id);
      if (x) delete x.keptRarity;
    }, `Asking about ${c.name}'s rarity again`);

  const patch = (id: string, p: Partial<Card>) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id);
      if (c) Object.assign(c, p);
    });

  /** Fuse one level with Fusion Up Kards from the Wallet, as done in the game. */
  function fuse(c: Card, cost: number) {
    update((d) => void fuseWithKards(d, c.id), `Used ${cost} Fusion Up Kard${cost === 1 ? '' : 's'} on ${c.name}`);
  }

  function rename(c: Card, text: string) {
    setRenaming({ id: c.id, was: renaming?.was ?? c.name, text });
    if (text.trim()) patch(c.id, { name: text });
  }

  // A cleared name goes back to the name it had, so there's always something to tap to rename the card again.
  function finishRename(c: Card) {
    const name = renaming?.text.trim() || renaming?.was.trim() || c.name;
    if (name !== c.name) patch(c.id, { name });
    setRenaming(null);
  }

  function add() {
    if (!draft.name.trim()) return;
    const isEquip = draftRule?.kind === 'equipment';
    const tower = isEquip && draft.source === 'tower' ? draft.sourceNote?.trim() : undefined;
    update((d) =>
      void d.cards.push({
        id: newId(),
        ...draft,
        name: draft.name.trim(),
        guest: !!draftRule?.hasGuests && draft.guest,
        source: isEquip ? draft.source : initialSource(draft, d.rarities),
        sourceNote: tower || undefined,
      }),
    );
    setDraft({ ...draft, name: '', fusion: 0, guest: false });
  }

  const rarityOrder = (c: Card) => (sortBy === 'name' ? 0 : state.rarities.findIndex((r) => r.id === c.rarityId));
  // Stored levels compare across rarities: F0 is 1 everywhere, and Gold ascension (A1+) comes after F10.
  const fusionOrder = (a: Card, b: Card) => (sortBy === 'fusion-high' ? b.fusion - a.fusion : sortBy === 'fusion-low' ? a.fusion - b.fusion : 0);
  // "kind:equipment" etc. groups every rarity of that kind (Diamond + Gold characters, all gear, both Kameo tiers).
  const inRarity = (c: Card, value: string) => value === 'all' || c.rarityId === value || value === `kind:${state.rarities.find((r) => r.id === c.rarityId)?.kind}`;
  const inSource = (c: Card, value: Source | 'all') => value === 'all' || (c.source ?? '') === value;
  // The card being renamed stays listed even if its new name no longer matches the search.
  const matchesSearch = (c: Card) => !q || c.id === renaming?.id || c.name.toLowerCase().includes(q.toLowerCase());
  // Each filter option shows how many cards it would list, given the search and the other filter.
  const rarityCount = (value: string) => state.cards.filter((c) => matchesSearch(c) && inSource(c, sourceFilter) && inRarity(c, value)).length;
  const sourceCount = (value: Source | 'all') => state.cards.filter((c) => matchesSearch(c) && inRarity(c, rarity) && inSource(c, value)).length;
  const cards = state.cards
    .filter((c) => matchesSearch(c) && inRarity(c, rarity) && inSource(c, sourceFilter))
    // Rarity then name by default, so a card doesn't jump around while you edit it. By fusion, ties keep that order.
    .sort((a, b) => fusionOrder(a, b) || rarityOrder(a) - rarityOrder(b) || a.name.localeCompare(b.name));

  return (
    <>
      <section className={card}>
        <h2>Add card</h2>
        <div className={form}>
          {/* Full width on phones; on wider screens the name shares its line with the other fields. */}
          <label className={`${field} col-span-full md:col-span-2`}>
            <span>Name</span>
            <input value={draft.name} placeholder="e.g. Sub-Zero, Klassic (name, variant)" onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <label className={field}>
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
            <label className={field}>
              <span>Current level</span>
              <select value={draft.fusion} onChange={(e) => setDraft({ ...draft, fusion: Number(e.target.value) })}>
                <LevelOptions rule={draftRule} />
              </select>
            </label>
          )}
          {draftRule && <GoalSelect rule={draftRule} value={draft.goal} onChange={(v) => setDraft({ ...draft, goal: v })} />}
          {draftRule && <CapSelect rule={draftRule} value={draft.maxLevel} onChange={(v) => setDraft({ ...draft, maxLevel: v })} />}
          {draftRule?.hasGuests && (
            <label className={check}>
              <input type="checkbox" checked={draft.guest} onChange={(e) => setDraft({ ...draft, guest: e.target.checked })} />
              Guest card
            </label>
          )}
          {draftRule?.kind === 'equipment' && (
            <label className={field}>
              <span>Source</span>
              <SourceSelect kind="equipment" value={draft.source} onChange={(v) => setDraft({ ...draft, source: v, sourceNote: undefined })} />
            </label>
          )}
          {draftRule?.kind === 'equipment' && draft.source === 'tower' && (
            <label className={field}>
              <span>Tower</span>
              <input value={draft.sourceNote ?? ''} placeholder="e.g. Lin Kuei Tower" onChange={(e) => setDraft({ ...draft, sourceNote: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
            </label>
          )}
          <button className={`${btn.primary} md:-col-end-1`} onClick={add} disabled={!draft.name.trim()}>
            Add
          </button>
        </div>
        {draftRule && cardGoal(draft as Card, draftRule) === 'threshold' && (
          <p className="text-muted text-small">
            {draftRule.label} is tracked only until F{draftRule.fusionUpThreshold}. After that, your Fusion Up Kards can max it.
          </p>
        )}
        <PasteList startRarityId={draft.rarityId} />
      </section>

      {/* Kept in view while scrolling a long list on wide screens, where it fits on one row; elsewhere it scrolls away as before. */}
      <div className="flex flex-wrap gap-2 mb-[0.8rem] items-center xl:sticky xl:top-0 xl:z-[2] xl:bg-bg xl:py-2">
        <input className="flex-1 min-w-0 md:min-w-[200px] md:max-w-[360px]" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="all">{`All rarities (${rarityCount('all')})`}</option>
          <option value="kind:character">{`All characters (${rarityCount('kind:character')})`}</option>
          <option value="kind:equipment">{`All equipment (${rarityCount('kind:equipment')})`}</option>
          <option value="kind:kameo">{`All Kameos (${rarityCount('kind:kameo')})`}</option>
          <optgroup label="One rarity">
            {state.rarities.map((r) => (
              <option key={r.id} value={r.id}>
                {`${r.label} (${rarityCount(r.id)})`}
              </option>
            ))}
          </optgroup>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as CardSort)} aria-label="Sort">
          <option value="rarity">Sort: rarity</option>
          <option value="fusion-high">Sort: fusion, highest first</option>
          <option value="fusion-low">Sort: fusion, lowest first</option>
          <option value="name">Sort: name</option>
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as Source | 'all')} aria-label="Filter by source">
          <option value="all">{`Any source (${sourceCount('all')})`}</option>
          <option value="">{`Packs/store (${sourceCount('')})`}</option>
          <option value="krypt">{`Krypt gear (${sourceCount('krypt')})`}</option>
          <option value="tower">{`Tower gear (${sourceCount('tower')})`}</option>
          <option value="challenge">{`Elder challenge (${sourceCount('challenge')})`}</option>
        </select>
        {missingImages.length > 0 && (
          <button className="xl:ml-auto" onClick={findImages} disabled={imgStatus?.busy} title="Look up card art on MK Mobile Base, then the MK Mobile wiki">
            {imgStatus?.busy ? 'Finding…' : `Find images (${missingImages.length})`}
          </button>
        )}
      </div>
      {imgStatus && <p className="text-small text-muted">{imgStatus.msg}</p>}
      {rarityFixes.length > 0 && (
        <div className={hint}>
          <p>MK Mobile Base lists a different rarity for {rarityFixes.length === 1 ? 'this card' : 'these cards'}:</p>
          <ul className="list-disc pl-[40px] my-[1em] text-small">
            {rarityFixes.map((f) => (
              <li key={f.card.id} className="mb-[0.3rem]">
                {f.card.name}: {ctx.rules.get(f.card.rarityId)?.label ?? f.card.rarityId} here, <b>{ctx.rules.get(f.to)?.label ?? f.to}</b> on the site{' '}
                <span className="inline-flex flex-wrap gap-[0.4rem] align-middle">
                  <button onClick={() => applyRarityFixes([f])}>Use the site's</button>
                  <button className={btn.ghost} onClick={() => keepRarities([f])}>
                    Keep mine
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {rarityFixes.length > 1 && (
            <div className={actions}>
              <button className={btn.primary} onClick={() => applyRarityFixes(rarityFixes)}>
                Use the site's for all
              </button>
              <button className={btn.ghost} onClick={() => keepRarities(rarityFixes)}>
                Keep mine for all
              </button>
            </div>
          )}
        </div>
      )}

      {cards.length === 0 && <p className="text-muted">No cards match.</p>}
      {/* Two columns only once each card is about 514px wide (from 1344px): a gear card's Goal, Source, Image and Delete need about 513px on one line. Never three. */}
      <div className="min-[1344px]:grid min-[1344px]:grid-cols-2 min-[1344px]:gap-[0.8rem]">
        {cards.map((c) => {
          const rule = ctx.rules.get(c.rarityId);
          if (!rule) return null;
          const max = maxFusion(rule);
          const target = targetLevel(c, rule);
          const toThr = copiesToThreshold(c, rule);
          const toMax = copiesToMax(c, rule);
          const kards = ctx.kardCopies.get(c.id) ?? 0;
          const kardCost = kardStep(state, c.id);
          return (
            <div key={c.id} className={`${surface} py-[0.7rem] px-[0.9rem] mb-[0.8rem] min-[1344px]:mb-0`}>
              <div className={`${row} items-center`}>
                <CardThumb card={c} rule={rule} />
                <div className={grow}>
                  {renaming?.id === c.id ? (
                    <input value={renaming.text} autoFocus onChange={(e) => rename(c, e.target.value)} onBlur={() => finishRename(c)} onKeyDown={(e) => e.key === 'Enter' && finishRename(c)} />
                  ) : (
                    <div className={`${rowTitle} hover:underline decoration-muted underline-offset-2 md:cursor-pointer`} onClick={() => setRenaming({ id: c.id, was: c.name, text: c.name })} title="Tap to rename">
                      {/* A card synced or saved with no name still needs something to tap. */}
                      {c.name.trim() || <span className="text-muted italic">Unnamed</span>}
                    </div>
                  )}
                  <div className="text-small">
                    <RarityBadge rule={rule} />
                    {c.guest && <Chip tone="guest">guest</Chip>}
                    {c.keptRarity && c.keptRarity !== c.rarityId && (
                      <Chip tone="muted" onClick={() => askRarityAgain(c)} title="You kept your rarity. Tap to be asked about the site's again.">
                        site says {ctx.rules.get(c.keptRarity)?.label ?? c.keptRarity}
                      </Chip>
                    )}
                    {c.source && <Chip tone="source">{SOURCE_LABELS[c.source]}{c.source === 'tower' && c.sourceNote && `: ${c.sourceNote}`}</Chip>}
                    {c.source === 'challenge' && (() => {
                      const ch = challengeFor(c, events, now);
                      return ch && <Chip tone="limited">challenge {challengeWhen(ch, now)}</Chip>;
                    })()}
                    {/* Cards that reach their goal are removed, so every card listed still has copies to go. */}
                    {toThr > 0 && thresholdLevel(rule)! < target && <Chip tone="warn">{toThr} to F{rule.fusionUpThreshold}</Chip>}
                    <Chip tone={cardGoal(c, rule) === 'threshold' ? 'warn' : 'muted'}>
                      {maxFusion(rule) === 1 ? 'Not owned yet' : `${toMax} to ${levelLabel(rule, target)}`}
                    </Chip>
                    {kards > 0 && <Chip tone="good">kards give {kards}</Chip>}
                  </div>
                </div>
                <div className={stepper}>
                  <button onClick={() => patch(c.id, { fusion: Math.max(0, c.fusion - 1) })} disabled={c.fusion <= 0} aria-label="Lower level">
                    −
                  </button>
                  <span className={stepperVal}>{c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}</span>
                  <button onClick={() => patch(c.id, { fusion: Math.min(max, c.fusion + 1) })} disabled={c.fusion >= max} aria-label="Raise level">
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-[0.4rem] items-center mt-[0.3rem]">
                {kardCost != null && (
                  <button onClick={() => fuse(c, kardCost)} title="Fuse one level with Fusion Up Kards from the Wallet">
                    Use {kardCost} kard{kardCost === 1 ? '' : 's'}
                  </button>
                )}
                <GoalSelect rule={rule} value={c.goal} onChange={(v) => patch(c.id, { goal: v })} />
                <CapSelect rule={rule} value={c.maxLevel} onChange={(v) => patch(c.id, { maxLevel: v })} />
                {rule.hasGuests && (
                  <label className={check}>
                    <input type="checkbox" checked={c.guest} onChange={(e) => patch(c.id, { guest: e.target.checked })} />
                    Guest
                  </label>
                )}
                {(rule.kind !== 'character' || c.source) && <SourceSelect kind={rule.kind} value={c.source} onChange={(v) => patch(c.id, { source: v, sourceNote: undefined })} />}
                {c.source === 'tower' && (
                  <input
                    className="w-[11rem]"
                    value={c.sourceNote ?? ''}
                    placeholder="Tower name"
                    aria-label="Tower"
                    onChange={(e) => patch(c.id, { sourceNote: e.target.value || undefined })}
                    onBlur={(e) => e.target.value !== e.target.value.trim() && patch(c.id, { sourceNote: e.target.value.trim() || undefined })}
                  />
                )}
                <button className={btn.ghost} onClick={() => setImageEditId(imageEditId === c.id ? null : c.id)}>
                  Image
                </button>
                <ConfirmButton
                  label="Delete"
                  className={btn.ghost}
                  onConfirm={() =>
                    update((d) => {
                      d.cards = d.cards.filter((x) => x.id !== c.id);
                      for (const p of d.packs) p.drops = p.drops.filter((x) => x.cardId !== c.id);
                    }, `Deleted ${c.name}`)
                  }
                />
              </div>
              {imageEditId === c.id && (
                <div className="flex flex-wrap gap-[0.4rem] items-center my-[0.35rem]">
                  <input
                    className="flex-1 min-w-0"
                    value={c.imageUrl ?? ''}
                    placeholder="Paste an image URL"
                    onChange={(e) => patch(c.id, { imageUrl: e.target.value.trim() || undefined, wikiTitle: undefined, imagePage: undefined })}
                  />
                  {(c.imagePage || c.wikiTitle) && (
                    <a className="text-small" href={c.imagePage ?? wikiUrl(c.wikiTitle!)} target="_blank" rel="noreferrer">
                      {(c.imagePage ?? '').includes('mkmobilebase') ? 'MK Mobile Base page' : 'Wiki page'}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
