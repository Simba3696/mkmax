import { Activity, useEffect, useMemo, useRef, useState } from 'react';
import { newId, noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { ascensionCaps, cardGoal, copiesToMax, copiesToThreshold, fLevel, fuseWithKards, isMaxed, isRealmKlashName, kardStep, levelLabel, maxFusion, stepCard, targetLevel, thresholdLevel } from '../engine';
import { CardThumb, Chip, ConfirmButton, LevelOptions, RarityBadge, SOURCE_LABELS, useBrokenImageUrls, useDeviceChoice } from '../ui';
import { actions, btn, card, check, field, form, grow, hint, row, rowTitle, subpanel, surface, stepper, stepperVal } from '../classes';
import TowersPanel from './TowersPanel';
import { findCardImages, wikiUrl } from '../wiki';
import { catalogPageUrl, findInCatalog, loadCatalog, rarityMismatches, wantsCatalogImage, type CatalogItem } from '../catalog';
import { cardKey, parseCardList } from '../cardList';
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
 * to max. Stored only when it differs from the rarity's goal. Realm Klash gear is always bought to max, so it gets
 * a label instead of a choice (see isRealmKlashName).
 */
function GoalSelect({ rule, name, value, onChange }: { rule: RarityRule; name: string; value: Card['goal']; onChange: (v: Card['goal']) => void }) {
  // Only equipment switches between "F3, Kards finish it" and buying to max; characters are always maxed.
  if (rule.kind !== 'equipment' || rule.fusionUpThreshold == null) return null;
  const max = levelLabel(rule, maxFusion(rule));
  if (isRealmKlashName(name)) return <span className={`${check} text-muted`}>Realm Klash gear (bought to {max} with Blood Rubies)</span>;
  return (
    <label className={check}>
      Goal
      <select value={value ?? rule.goal} onChange={(e) => onChange(e.target.value === rule.goal ? undefined : (e.target.value as Card['goal']))}>
        <option value="threshold">F{rule.fusionUpThreshold} (Kards finish it)</option>
        <option value="max">{`Max (${max})`}</option>
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
function PasteList({ pick, startRarityId }: { pick: number; startRarityId: string }) {
  const { state, update } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // The list is read with the rarities, their names and the rarity picked above as they were while it was typed, so a
  // sync can't change what it means. Every rarity and name seen is kept: a line under a rarity another device removed
  // (picked above, a heading or after " - ") is skipped, rather than filed under whichever rarity comes before it or
  // the heading becoming a card, and a heading still matches a rarity renamed since. The rarity picked above changes
  // when the box opens (to the one the form shows) or a rarity is picked in the box above (`pick` counts those), not
  // when a sync removes it while the box is open and the form shows the first rarity instead.
  const [known, setKnown] = useState(state.rarities);
  const rarities = useMemo(() => [...state.rarities, ...known.filter((r) => !state.rarities.some((x) => x.id === r.id && x.label === r.label))], [state.rarities, known]);
  const [start, setStart] = useState({ pick, id: startRarityId });
  // A box opened with no rarities follows the first one a sync brings in, or its plain lines would have none. It's
  // remembered too, so a sync that removes it before the next keystroke still has its lines listed as skipped.
  if (start.pick !== pick || (!start.id && startRarityId)) {
    if (!start.id) setKnown(rarities);
    setStart({ pick, id: startRarityId });
  }
  const remember = () => setKnown(rarities);
  // After an Add that left lines behind, the box stays until Done. A card that Add saved at its goal is deleted at once
  // as done, so its line would read as new again: it's left out (`gone`). The other cards Add saved now match the list
  // and aren't listed as skipped (`justAdded`) until the list is edited, when they read as already listed like any other.
  // An Undo or a delete brings their lines back as new.
  const [leftOver, setLeftOver] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const parsed = useMemo(() => parseCardList(text, rarities, start.id, state.cards), [text, rarities, start.id, state.cards]);
  const live = (rarityId: string) => state.rarities.some((r) => r.id === rarityId);
  // Only a rarity the list knew: with no rarities at all, plain lines have none, and the Settings note covers them.
  const isRemoved = (c: (typeof parsed.cards)[number]) => !live(c.rarityId) && rarities.some((r) => r.id === c.rarityId);
  // An update to a card a sync left without its rarity can't be saved (there are no rules to check its goal against), so
  // it's skipped with the other lines whose rarity has gone, not offered as an update that does nothing.
  const isOrphan = (u: (typeof parsed.updates)[number]) => state.cards.some((c) => c.id === u.cardId && !live(c.rarityId));
  const updates = parsed.updates.filter((u) => !isOrphan(u));
  const removedLines = [...parsed.cards.filter(isRemoved).map((c) => c.line), ...parsed.updates.filter(isOrphan).map((u) => u.line)];
  // `gone` holds the lines as typed, so an edited line (a lower level, say) is offered again, and a line that reads
  // differently once its card is gone (a Stage line brings a maxed card back) still matches.
  const newCards = parsed.cards.filter((c) => live(c.rarityId) && !gone.has(c.line));
  const counts = state.rarities
    .map((r) => ({ label: r.label, n: newCards.filter((c) => c.rarityId === r.id).length }))
    .filter((x) => x.n > 0);

  if (!open) {
    return (
      <div className={actions}>
        <button onClick={() => (remember(), setStart({ pick, id: startRarityId }), setOpen(true))}>Paste a list…</button>
      </div>
    );
  }

  const total = newCards.length + updates.length;
  // After an Add, the cards it just saved now match the list: they were added, not skipped, so they aren't listed (until
  // the list is edited).
  const skipped = parsed.duplicates.filter((x) => !justAdded.has(x.key)).map((x) => x.name);
  function addAll() {
    let added = 0;
    let updated = 0;
    let saved: string[] = [];
    let done: string[] = [];
    update(
      (d) => {
        // Not under a rarity a sync removed after the list was read: those cards would be hidden everywhere, with no way
        // to delete them. Nor a card a sync has added meanwhile (the same list pasted on another device), which would
        // then be in twice. Nor updates to cards a sync removed.
        const have = new Set(d.cards.map((x) => cardKey(x.rarityId, x.name)));
        const cards = newCards.filter((c) => d.rarities.some((r) => r.id === c.rarityId) && !have.has(cardKey(c.rarityId, c.name)));
        // Nor to a card left without its rarity (an older build or an imported file can leave one): it has no rules to
        // check its goal against.
        const saving = updates.flatMap((u) =>
          d.cards.filter((c) => c.id === u.cardId && d.rarities.some((r) => r.id === c.rarityId)).map((c) => ({ c, patch: u.patch, line: u.line })),
        );
        if (!cards.length && !saving.length) return noChange;
        const fresh = cards.map(
          (c): Card => ({
            id: newId(),
            name: c.name,
            rarityId: c.rarityId,
            // As Add card does: a level a sync has since taken off the rarity is saved as not owned.
            fusion: (c.fusion ?? 0) <= maxFusion(d.rarities.find((r) => r.id === c.rarityId)!) ? (c.fusion ?? 0) : 0,
            guest: false,
            source: c.source ?? initialSource(c, d.rarities),
            ...(c.sourceNote && { sourceNote: c.sourceNote }),
            ...(c.maxLevel != null && { maxLevel: c.maxLevel }),
          }),
        );
        d.cards.push(...fresh);
        for (const { c, patch } of saving) Object.assign(c, patch);
        added = cards.length;
        updated = saving.length;
        const touched = [...fresh, ...saving.map(({ c }) => c)];
        saved = touched.map((c) => cardKey(c.rarityId, c.name));
        // At their goal now, so the save deletes them as done: their lines are left out from then on.
        const ruleOf = (c: Card) => d.rarities.find((r) => r.id === c.rarityId)!;
        done = [
          ...cards.filter((_, i) => isMaxed(fresh[i], ruleOf(fresh[i]))).map((c) => c.line),
          ...saving.filter(({ c }) => isMaxed(c, ruleOf(c))).map(({ line }) => line),
        ];
      },
      () => {
        const label = [added && `added ${added} card${added === 1 ? '' : 's'}`, updated && `updated ${updated}`].filter(Boolean).join(', ');
        return label.charAt(0).toUpperCase() + label.slice(1);
      },
    );
    // A list with lines that weren't added (a sync left them nowhere to go, or they were skipped) stays, so they aren't
    // lost, and Done clears the box.
    if (added + updated < total || removedLines.length || parsed.problems.length) {
      setGone((g) => new Set([...g, ...done]));
      setJustAdded((j) => new Set([...j, ...saved]));
      setLeftOver(true);
      return;
    }
    close();
  }
  function close() {
    setText('');
    setLeftOver(false);
    setGone(new Set());
    setJustAdded(new Set());
    setOpen(false);
  }

  const startLabel = rarities.find((r) => r.id === start.id)?.label ?? '';
  return (
    <div className={subpanel}>
      {/* A readable line length; the textarea below still takes the full width. */}
      <p className="text-muted text-small md:max-w-[80ch]">
        One card per line. A line can be just a name, like "Jade, Lizard", which goes in as not owned.{' '}
        {/* With no rarities at all, the line under the box says to add one. */}
        {!startLabel ? null : live(start.id) ? (
          <>Those use {startLabel} (the rarity picked above) until a line that's just a rarity name, like "Gold Kameo", switches it. </>
        ) : (
          <>
            Those would use {startLabel}, which has since been removed, so they're skipped until a line that's just a rarity name, like "Gold Kameo",
            switches it.{' '}
          </>
        )}
        A line can also add details after " - ": rarity, where it comes from and level, like
        "Kori Blade - Epic - Lin Kuei Tower - F2" or "Man in Control - Epic - Krypt Gear - Unowned". Cards already in your list get the new level and source. When an
        update makes Gold characters ascendable, add "Stage I" (Max A5) or "Stage II" (Max A10), like "Kenshi, Elder God - Gold - Stage I": a card not in your list
        was maxed, so it comes back at the cap below with 5 copies to go.
      </p>
      <textarea value={text} onChange={(e) => (setText(e.target.value), setJustAdded(new Set()), remember())} placeholder={'Gold Kameo\nJade, Lizard\nKori Blade - Epic - Lin Kuei Tower - F2'} autoFocus />
      <div className="text-small text-muted">
        {!state.rarities.length
          ? 'Add a rarity in Settings first: every card needs one.'
          : counts.length
            ? `New: ${counts.map((x) => `${x.n} ${x.label}`).join(' · ')}`
            : updates.length
              ? ''
              : leftOver
                ? 'Nothing left to add.'
                : 'Nothing to add yet.'}
        {updates.length > 0 && ` · updating ${updates.length} already listed (${updates.map((u) => u.name).join('; ')})`}
        {skipped.length > 0 && ` · skipping ${skipped.length} already listed (${skipped.join('; ')})`}
      </div>
      {parsed.problems.length + removedLines.length > 0 && (
        <ul className="list-disc pl-[40px] my-[1em] text-error text-small">
          {/* Keyed by place too: the same line can be pasted twice. */}
          {parsed.problems.map((p, i) => (
            <li key={`${i}|${p.line}`}>
              Skipped "{p.line}": {p.reason}.
            </li>
          ))}
          {removedLines.map((line, i) => (
            <li key={`removed|${i}|${line}`}>Skipped "{line}": its rarity has since been removed.</li>
          ))}
        </ul>
      )}
      <div className={actions}>
        {/* After an Add, what's in the box was already handled, so Done (which clears it) takes Cancel's place. */}
        {leftOver ? (
          <button className={total ? undefined : btn.primary} onClick={close}>
            Done
          </button>
        ) : (
          <button onClick={() => setOpen(false)}>Cancel</button>
        )}
        {(!leftOver || total > 0) && (
          <button className={btn.primary} disabled={!total} onClick={addAll}>
            {newCards.length > 0 && `Add ${newCards.length}`}
            {newCards.length > 0 && updates.length > 0 && ', '}
            {updates.length > 0 && `update ${updates.length}`}
            {!total && 'Add cards'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Which of the Cards tab's two pages is showing. App holds it, so tapping the Cards tab again can switch it. */
export type CardsPage = 'cards' | 'towers';

export default function CardsView({ sub, onSub }: { sub: CardsPage; onSub: (sub: CardsPage) => void }) {
  return (
    <>
      {/* A short switch on wide screens: stretched across 1000px+ it reads as a banner, not two buttons. */}
      <div className="flex mb-[0.8rem] border border-line rounded-panel overflow-hidden md:max-w-[360px]">
        <button className={segment(sub === 'cards')} onClick={() => onSub('cards')} aria-pressed={sub === 'cards'}>
          Cards
        </button>
        <button className={segment(sub === 'towers')} onClick={() => onSub('towers')} aria-pressed={sub === 'towers'}>
          Tower gear
        </button>
      </div>
      {/*
        Both keep their state, so switching pages keeps a half-typed card, a pasted list or a search on the card list.
        Activity hides the other page: it still redraws, at low priority, but its effects (like the catalog download) wait
        until it's shown.
      */}
      <Activity mode={sub === 'cards' ? 'visible' : 'hidden'}>
        <CardList />
      </Activity>
      <Activity mode={sub === 'towers' ? 'visible' : 'hidden'}>
        <TowersPanel />
      </Activity>
    </>
  );
}

const segment = (active: boolean) => `flex-1 border-0 rounded-none focus-visible:-outline-offset-2 ${active ? 'bg-red-dim text-fg' : 'bg-panel text-muted hover:text-fg'}`;

const CARD_SORTS = ['rarity', 'fusion-high', 'fusion-low', 'name'] as const;
type CardSort = (typeof CARD_SORTS)[number];

function CardList() {
  const { state, update } = useStore();
  const { now, ctx } = usePlan();
  const events = useEvents();
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
  // Counts picks in the Rarity box, so a pasted list follows a new pick but not a sync that removed the picked rarity.
  const [picks, setPicks] = useState(0);

  const draftRule = ctx.rules.get(draft.rarityId) ?? state.rarities[0];
  // What the form shows, and Add card saves: the rarity picked, or the first once a sync has removed that one (the box
  // shows the first). Falling back starts that rarity's level, goal and cap at their defaults, since the removed
  // rarity's don't fit it (a Gold A2 would be saved at a Diamond's max and deleted at once as maxed).
  const shown = !draftRule || draftRule.id === draft.rarityId ? draft : { ...draft, rarityId: draftRule.id, fusion: 0, maxLevel: null, goal: undefined };
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
      // The lookup can take minutes: a card whose image a sync changed meanwhile (one pasted on another device) keeps it.
      const lookedUp = new Map(missingImages.map((c) => [c.id, c.imageUrl]));
      // Counted from the change itself, so a card a sync gave an image meanwhile is counted as that, not as updated or as
      // one to paste an image for.
      let updated = 0;
      let meanwhile = 0;
      // Of the cards looked up, those still in the save: a sync may have deleted some during the lookup.
      let total = missingImages.length;
      let left = 0;
      update((d) => {
        const cards = d.cards.filter((c) => lookedUp.has(c.id) && lookedUp.get(c.id) === c.imageUrl);
        meanwhile = d.cards.filter((c) => lookedUp.has(c.id) && lookedUp.get(c.id) !== c.imageUrl).length;
        total = d.cards.filter((c) => lookedUp.has(c.id)).length;
        left = cards.filter((c) => !found.has(c.id) && (!c.imageUrl || brokenUrls.has(c.imageUrl))).length;
        const art = cards.flatMap((c) => (found.has(c.id) ? [{ c, m: found.get(c.id)! }] : []));
        const checked = cards.filter((c) => keep.some((k) => k.id === c.id) && c.wikiTitle && c.imagePage !== wikiUrl(c.wikiTitle));
        if (!art.length && !checked.length) return noChange;
        for (const { c, m } of art) Object.assign(c, m);
        for (const c of checked) c.imagePage = wikiUrl(c.wikiTitle!);
        updated = art.length;
      });
      const leftMsg = !left
        ? ''
        : wikiError
          ? ` Couldn't reach the MK Mobile wiki (${wikiError}), so ${left} weren't looked up there. Try again later.`
          : ` ${left} not found online: open "Image" on those cards to paste a URL.`;
      const meanwhileMsg = !meanwhile ? '' : meanwhile === 1 ? ' 1 got an image during the lookup and kept it.' : ` ${meanwhile} got images during the lookup and kept them.`;
      setImgStatus({ busy: false, msg: `Updated ${updated} of ${total}.${meanwhileMsg}${leftMsg}` });
    } catch (e) {
      setImgStatus({ busy: false, msg: `Couldn't look up images: ${(e as Error).message}` });
    }
  }

  const cardCount = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  const whichCards = (fixes: typeof rarityFixes) => (fixes.length === 1 ? fixes[0].card.name : cardCount(fixes.length));
  // The answers go only to cards still waiting for them: a sync may have removed some, or already answered for them.
  // Nor to a rarity a sync has removed, where the card would be hidden. The Undo label counts the cards actually changed.
  function applyRarityFixes(fixes: typeof rarityFixes) {
    let done: typeof fixes = [];
    update(
      (d) => {
        const found = fixes
          .filter((f) => d.rarities.some((r) => r.id === f.to))
          .flatMap((f) => d.cards.filter((c) => c.id === f.card.id && c.rarityId !== f.to && c.keptRarity !== f.to).map((c) => ({ f, c })));
        if (!found.length) return noChange;
        for (const { f, c } of found) applyRarityFix(c, f.to, d.rarities);
        done = found.map((x) => x.f);
      },
      () => `Changed the rarity of ${whichCards(done)}`,
    );
  }

  function keepRarities(fixes: typeof rarityFixes) {
    let done: typeof fixes = [];
    update(
      (d) => {
        const found = fixes.flatMap((f) => d.cards.filter((c) => c.id === f.card.id && c.rarityId !== f.to && c.keptRarity !== f.to).map((c) => ({ f, c })));
        if (!found.length) return noChange;
        for (const { f, c } of found) c.keptRarity = f.to;
        done = found.map((x) => x.f);
      },
      () => `Kept your rarity for ${whichCards(done)}`,
    );
  }

  // Brings a kept card back into the rarity check, in case Keep mine was the wrong choice.
  const askRarityAgain = (c: Card) =>
    update((d) => {
      const x = d.cards.find((y) => y.id === c.id);
      if (!x?.keptRarity) return noChange; // removed, or already asked again
      delete x.keptRarity;
    }, `Asking about ${c.name}'s rarity again`);

  // Edits find the card by id when they run, and save nothing for a card a sync has removed.
  const patch = (id: string, p: Partial<Card>) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id);
      if (!c) return noChange;
      Object.assign(c, p);
    });

  // A level tap steps from the level it showed: saving that level ± 1 would undo a level a sync has added since.
  const stepLevel = (c: Card, by: 1 | -1) =>
    update((d) => (d.cards.find((x) => x.id === c.id)?.fusion === c.fusion && stepCard(d, c.id, by) ? undefined : noChange));

  /** Fuse one level with Fusion Up Kards from the Wallet, as done in the game: the step the button showed, or none. */
  function fuse(c: Card, cost: number) {
    update((d) => (fuseWithKards(d, c.id, cost, c.fusion) == null ? noChange : undefined), `Used ${cost} Fusion Up Kard${cost === 1 ? '' : 's'} on ${c.name}`);
  }

  function rename(c: Card, text: string) {
    setRenaming({ id: c.id, was: renaming?.was ?? c.name, text });
    if (text.trim()) patch(c.id, { name: text });
  }

  // Activity hides this page without a blur and runs its effects again when it's shown: a rename left open then is
  // finished as a blur would (a cleared name goes back), since its box no longer has focus to lose.
  const openRename = useRef(renaming);
  useEffect(() => void (openRename.current = renaming));
  useEffect(() => {
    const r = openRename.current;
    if (!r) return;
    const name = r.text.trim() || r.was.trim();
    update((d) => {
      const c = d.cards.find((x) => x.id === r.id);
      if (!c || !name || c.name === name) return noChange;
      c.name = name;
    });
    setRenaming(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A cleared name goes back to the name it had, so there's always something to tap to rename the card again.
  function finishRename(c: Card) {
    const name = renaming?.text.trim() || renaming?.was.trim() || c.name;
    if (name !== c.name) patch(c.id, { name });
    setRenaming(null);
  }

  function add() {
    if (!shown.name.trim()) return;
    let added = false;
    update((d) => {
      // Not under a rarity a sync removed after the form was drawn: the card would be hidden everywhere, with no way to
      // delete it. Its kind and steps come from the rarity as it is now.
      const rule = d.rarities.find((r) => r.id === shown.rarityId);
      if (!rule) return noChange;
      const isEquip = rule.kind === 'equipment';
      const tower = isEquip && shown.source === 'tower' ? shown.sourceNote?.trim() : undefined;
      d.cards.push({
        id: newId(),
        ...shown,
        name: shown.name.trim(),
        // A level a sync has since taken off the rarity isn't one the level box can show: it shows (and saves) not owned.
        fusion: shown.fusion <= maxFusion(rule) ? shown.fusion : 0,
        guest: rule.hasGuests && shown.guest,
        source: isEquip ? shown.source : initialSource(shown, d.rarities),
        sourceNote: tower || undefined,
      });
      added = true;
    });
    // The typed name stays for another try when nothing was added.
    if (added) setDraft({ ...shown, name: '', fusion: 0, guest: false });
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
            <input value={shown.name} placeholder="e.g. Sub-Zero, Klassic (name, variant)" onChange={(e) => setDraft({ ...shown, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <label className={field}>
            <span>Rarity</span>
            <select value={shown.rarityId} onChange={(e) => (setDraft({ ...shown, rarityId: e.target.value, fusion: 0, maxLevel: null }), setPicks((n) => n + 1))}>
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
              <select value={shown.fusion} onChange={(e) => setDraft({ ...shown, fusion: Number(e.target.value) })}>
                <LevelOptions rule={draftRule} />
              </select>
            </label>
          )}
          {draftRule && <GoalSelect rule={draftRule} name={shown.name} value={shown.goal} onChange={(v) => setDraft({ ...shown, goal: v })} />}
          {draftRule && <CapSelect rule={draftRule} value={shown.maxLevel} onChange={(v) => setDraft({ ...shown, maxLevel: v })} />}
          {draftRule?.hasGuests && (
            <label className={check}>
              <input type="checkbox" checked={shown.guest} onChange={(e) => setDraft({ ...shown, guest: e.target.checked })} />
              Guest card
            </label>
          )}
          {draftRule?.kind === 'equipment' && (
            <label className={field}>
              <span>Source</span>
              <SourceSelect kind="equipment" value={shown.source} onChange={(v) => setDraft({ ...shown, source: v, sourceNote: undefined })} />
            </label>
          )}
          {draftRule?.kind === 'equipment' && shown.source === 'tower' && (
            <label className={field}>
              <span>Tower</span>
              <input value={shown.sourceNote ?? ''} placeholder="e.g. Lin Kuei Tower" onChange={(e) => setDraft({ ...shown, sourceNote: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
            </label>
          )}
          <button className={`${btn.primary} md:-col-end-1`} onClick={add} disabled={!shown.name.trim()}>
            Add
          </button>
        </div>
        {draft.rarityId && draftRule && draftRule.id !== draft.rarityId && (
          <p className="text-muted text-small">The rarity picked here has since been removed, so this card goes in as {draftRule.label}.</p>
        )}
        {draftRule && cardGoal(shown as Card, draftRule) === 'threshold' && (
          <p className="text-muted text-small">
            {draftRule.label} is tracked only until F{draftRule.fusionUpThreshold}. After that, your Fusion Up Kards can max it.
          </p>
        )}
        <PasteList pick={picks} startRarityId={draftRule?.id ?? ''} />
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
                  <button onClick={() => stepLevel(c, -1)} disabled={c.fusion <= 0} aria-label="Lower level">
                    −
                  </button>
                  <span className={stepperVal}>{c.fusion === 0 ? '—' : levelLabel(rule, c.fusion)}</span>
                  <button onClick={() => stepLevel(c, 1)} disabled={c.fusion >= max} aria-label="Raise level">
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
                <GoalSelect rule={rule} name={c.name} value={c.goal} onChange={(v) => patch(c.id, { goal: v })} />
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
                      const kept = d.cards.filter((x) => x.id !== c.id);
                      if (kept.length === d.cards.length) return noChange; // a sync already removed it
                      d.cards = kept;
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
