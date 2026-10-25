import { Activity, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { newId, noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { ascensionCaps, atTopLevel, cardGoal, copiesToMax, entryGoal, copiesToThreshold, fLevel, fuseWithKards, isMaxed, isRealmKlashName, kardStep, levelLabel, maxFusion, onMaxedRecord, recordMaxed, stepCard, targetLevel, thresholdLevel, respellTower, towerKey, towerName, towerRespells, towerSpellings, unmarkMaxed } from '../engine';
import { CardThumb, Chip, ConfirmButton, LevelOptions, RarityBadge, onMaxedNote, SOURCE_LABELS, useBrokenImageUrls, useDeviceChoice } from '../ui';
import { actions, btn, card, check, field, form, grow, hint, row, rowTitle, subpanel, surface, stepper, stepperVal } from '../classes';
import TowersPanel from './TowersPanel';
import MaxedPanel from './MaxedPanel';
import { CardsIcon, TowerIcon, TrophyIcon } from '../icons';
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

/** The Tower list's "Add a tower or fix its spelling…" choice; not a name anyone types. */
const NEW_TOWER = '\u0000new';

/**
 * Saves a Tower box's name. With `over`, only over the tower the box last saved, so one a sync brought in since stands;
 * `respell` marks a finished typed name, which fixes the tower's spelling on other cards too (respellTower), and `was`
 * is the tower the box goes back to (see TowerEdit), which that fix's Undo puts back. A card's box and Add card's take
 * the same `over`.
 */
type TowerWrite = (v: string | undefined, over?: TowerOver) => void;
type TowerOver = { saved: string | undefined; respell?: boolean; was?: string };
// As a rename: what an emptied box goes back to (`was`: the tower the box opened on, or the name saved when the app was
// hidden if it opened on one; none in the plain box) and the tower the box last saved.
type TowerEdit = { text: string; was: string | undefined; saved: string | undefined };

/** Leaving a Tower box saves the name tidied (towerName), or the tower it had if it's empty, over the tower the box last saved. */
const finishTower = (e: TowerEdit, write: TowerWrite) => {
  const typed = towerName(e.text);
  write(typed || e.was, { saved: e.saved, respell: !!typed, was: e.was });
};

// How the user last acted on the page: with keys (Tab, arrows, Enter, typing) or a pointer (a tap or click). It's watched
// on the whole page, so a tap on a label counts, a key after a click counts as keys, and focus coming back with the app
// changes nothing.
let lastInput: 'key' | 'pointer' = 'pointer';
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => void (lastInput = 'key'), true);
  document.addEventListener('pointerdown', () => void (lastInput = 'pointer'), true);
}

/**
 * A tower picked from the ones your gear already names, so one tower isn't typed two ways, or a new one typed in.
 * While a name is being typed the box stays a text box until it's left, so it doesn't turn into the list mid-word once
 * the card saves the first letters; with no towers named yet it's only a text box. A pick from the list goes to onPick
 * (with Undo, on a card); a typed name saves as it's typed, as a rename does. `respells` counts the other cards a typed
 * name would re-spell when it's finished, which a line says beforehand: on its own line at the end of a card's row of
 * controls, or in `hintIn` (Add card's notes under its form, where it can't move the form's boxes), so nothing moves
 * sideways or out of line while it comes and goes.
 */
function TowerSelect({ towers, value, onChange, onPick, onEnter, respells, hintIn, className, placeholder = 'e.g. Lin Kuei Tower' }: { towers: string[]; value: string | undefined; onChange: TowerWrite; onPick?: (v: string | undefined) => void; onEnter?: () => void; respells: (name: string) => number; hintIn?: HTMLElement | null; className?: string; placeholder?: string }) {
  const pick = onPick ?? onChange;
  const hintId = useId();
  // The name being typed, the tower an emptied box goes back to (the one the card had before the name box was opened,
  // or, if it opened on one, the name saved when the app was hidden; none in the plain box, which has no list to go back
  // to), and the tower this box last saved. Null while picking from the list, or before the first key in the plain box.
  const [edit, setEdit] = useState<TowerEdit | null>(null);
  // Enter in a card's name box leaves it (so it's finished) and puts focus on the list that replaces it, rather than
  // dropping it to the page.
  const focusList = useRef(false);
  useEffect(() => {
    focusList.current = false;
  });
  // Whether the list or box has focus. When one replaces the other while it does and the user last acted with keys (No
  // tower picked on the last tower named turns the list into the plain box, Add card's Enter names the first tower, or a
  // sync names the first tower or takes away the last one), the one that replaces it takes focus, so a keyboard user
  // doesn't lose their place. After a tap or click focus never moves, so a phone doesn't open its keyboard on the new box.
  // A removed element gives no blur, so the flag holds until the one that replaces it is in place; then it says whether
  // that one has focus, so a key pressed later in another box (this runs on every render) never pulls focus here.
  const focused = useRef(false);
  // The list or box in place, and whether the box's last blur came from the window losing focus (see its onBlur).
  const control = useRef<HTMLElement | null>(null);
  const blurredAway = useRef(false);
  const keepFocus = (el: HTMLElement | null) => {
    if (!el) return;
    control.current = el;
    if ((focusList.current || (focused.current && lastInput === 'key')) && el !== document.activeElement) el.focus();
    focused.current = el === document.activeElement;
  };

  // A closed list steps through its towers with the arrow keys (and letters) on a computer, changing with each key. Each
  // step would save a tower with its own Undo, and stepping past the last tower would open the name box, so a step
  // is held (shown, not saved) until the list is left or Enter is pressed (a held tower is also saved when the app is
  // hidden): on a card, where each pick saves with Undo, any tower; anywhere, the name box's option, which leaving the
  // list drops. A tap or a click saves at once.
  // A key marks the change it makes before it's let go (a pick in a list a key opened is at worst held until it's left).
  const [held, setHeld] = useState<string | null>(null);
  const keyed = useRef(false);
  const typed = value?.trim();
  const listed = typed && towers.find((t) => towerKey(t) === towerKey(typed));
  const current = listed || typed || '';
  // A step a sync has made stale (its tower removed or re-spelled, or the list gone) is dropped, so leaving the list or
  // hiding the app never saves a tower the list doesn't show.
  const heldNow = !edit && towers.length && (held === null || held === '' || held === NEW_TOWER || held === typed || towers.includes(held)) ? held : null;
  useEffect(() => void (held !== null && heldNow === null && setHeld(null)), [held, heldNow]);
  // Leaving the list drops a held name box option; Enter opens the box.
  const settle = (v: string, enter: boolean) => {
    setHeld(null);
    if (v === NEW_TOWER) {
      if (enter) setEdit({ text: '', was: value?.trim() ? value : undefined, saved: value });
    } else if (v !== current) pick(v || undefined);
  };

  // Hiding the page (Activity, for Tower gear or Maxed, or a swipe to another tab) may give the box or list no blur, so
  // in the cleanup a box left open is finished and closed and a held step is settled, as leaving them does.
  // Hiding the app gives no blur either, and a phone may close it while it's away, so the name is finished then too (and
  // a tower held by the arrow keys is saved); the box stays open with what was typed, and is finished again when it's
  // left. It's done at once (flushSync), so the store's save runs before the page can be frozen or closed, not in a later
  // task that may never come.
  const openEdit = useRef({ edit, onChange, held: heldNow, settle, value });
  // Kept up to date in a layout effect, which runs inside flushSync's commit, so the hide's read-back below sees the
  // tower its save left.
  useLayoutEffect(() => void (openEdit.current = { edit, onChange, held: heldNow, settle, value }));
  useEffect(() => {
    const away = () => {
      if (document.visibilityState !== 'hidden') return;
      const { edit: e, onChange: write, held: h, settle: done } = openEdit.current;
      if (e) {
        flushSync(() => finishTower(e, write));
        // A box that opened on a tower goes on from the name it just saved, so finishing it again later (its Undo, or
        // an emptied box) goes back to that, the spelling every card now has, not to the one before the app was left.
        // One that opened on none (the plain box, or a card with no tower) still leaves none when it's emptied. If the
        // save didn't go through (a tower a sync brought in since stands), the box goes on as it was. The save has
        // rendered by now (flushSync), so the tower this box shows is the one saved.
        const now = towerName(e.text) || e.was;
        const saved = openEdit.current.value === now;
        flushSync(() => setEdit({ ...e, was: saved && e.was !== undefined ? now : e.was, saved: saved ? now : e.saved }));
      } else if (h !== null && h !== NEW_TOWER) flushSync(() => done(h, false));
    };
    document.addEventListener('visibilitychange', away);
    // A box left open by switching apps is finished and closed on coming back if focus doesn't come back to it (a phone
    // may hand it to the page), as leaving it does; otherwise nothing would ever finish it. Checked after the browser's
    // own focus restore, which comes just after the window's focus.
    let back: ReturnType<typeof setTimeout> | undefined;
    const returned = () => {
      clearTimeout(back);
      back = setTimeout(() => {
        const { edit: e, onChange: write } = openEdit.current;
        if (!blurredAway.current || control.current === document.activeElement) return;
        blurredAway.current = false;
        focused.current = false;
        if (e) finishTower(e, write);
        setEdit(null);
      });
    };
    window.addEventListener('focus', returned);
    return () => {
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('focus', returned);
      clearTimeout(back);
      const { edit: e, onChange: write, held: h, settle: done } = openEdit.current;
      // A held step is settled as leaving the list does: a tower is saved with Undo, the name box's option is dropped.
      if (e) finishTower(e, write);
      else if (h !== null) done(h, false);
      // Closed now, so the page is back to the list when it's shown again.
      setEdit(null);
    };
  }, []);

  if (edit || towers.length === 0) {
    const cur = edit ?? { was: undefined, saved: value };
    // Said before the name is finished, as the re-spell changes cards the user didn't touch.
    const name = edit ? towerName(edit.text) : '';
    const others = name ? respells(name) : 0;
    const say = `fixes the spelling on ${others} other card${others === 1 ? '' : 's'} when you finish`;
    const hint =
      others > 0 &&
      (hintIn === undefined ? (
        <span id={hintId} className="text-small text-muted basis-full order-last">
          {say[0].toUpperCase() + say.slice(1)}
        </span>
      ) : (
        hintIn &&
        createPortal(
          // Under the form, so it says which box it's about.
          <p id={hintId} className="text-muted text-small md:max-w-[80ch]">
            Tower: {say}
          </p>,
          hintIn,
        )
      ));
    return (
      <>
        <input
          ref={keepFocus}
          className={className}
          aria-describedby={others ? hintId : undefined}
          value={edit?.text ?? value ?? ''}
          placeholder={towers.length ? 'Tower name' : placeholder}
          aria-label="Tower"
          autoFocus={!!edit}
          onChange={(e) => {
            const text = e.target.value;
            if (text.trim()) onChange(text);
            else onChange(cur.was, { saved: cur.saved });
            setEdit({ text, was: cur.was, saved: text.trim() ? text : cur.was });
          }}
          onFocus={() => void (focused.current = true)}
          onBlur={() => {
            // Some browsers (Chrome) blur the box when you switch to another app or tab. It stays open then, as hiding
            // the app finishes it (above), so a name can be copied from elsewhere and finished on return.
            if (!document.hasFocus()) return void (blurredAway.current = true);
            focused.current = false;
            if (edit) finishTower(edit, onChange);
            setEdit(null);
          }}
          // A box with a name open (typed in, or opened from the list) turns into the list when it's left while the list
          // has towers; an untouched plain box doesn't rerender, so a flag set for it would wait and take focus the next
          // time the list shows, and an emptied plain box stays a box, which the flag would focus again.
          onKeyDown={(e) => {
            // An Enter that confirms a word in an input method (Chinese, Japanese) isn't the user finishing the name.
            // Safari ends the composition before that Enter's keydown, which then only shows it by keyCode 229.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (!onEnter) {
              focusList.current = !!edit && towers.length > 0;
              return e.currentTarget.blur();
            }
            // The name is finished first (so a new spelling is fixed on the other cards), then the form's Enter runs. It's
            // finished in place rather than by leaving the box, so focus stays here while it's still a text box; if the
            // form's Enter names the first tower and the list replaces the box, the list takes focus (keepFocus).
            if (edit) {
              finishTower(edit, onChange);
              setEdit(null);
            }
            onEnter();
          }}
        />
        {hint}
      </>
    );
  }
  return (
    <select
      ref={keepFocus}
      className={className}
      value={heldNow ?? current}
      aria-label="Tower"
      onChange={(e) => {
        const v = e.target.value;
        if (keyed.current && (v === NEW_TOWER || onPick)) return setHeld(v === current ? null : v);
        settle(v, true);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return void (keyed.current = true);
        if (heldNow !== null) return settle(heldNow, true);
        onEnter?.();
      }}
      onKeyUp={() => void (keyed.current = false)}
      onPointerDown={() => void (keyed.current = false)}
      onFocus={() => void (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (heldNow !== null) settle(heldNow, false);
      }}
    >
      {/* Once a tower is set, picking this takes it off the card, so it says so. */}
      <option value="">{typed ? 'No tower' : 'Choose a tower…'}</option>
      {typed && !listed && <option value={typed}>{typed}</option>}
      {towers.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value={NEW_TOWER}>Add a tower or fix its spelling…</option>
    </select>
  );
}

/**
 * Goal for rarities with a Fusion Up Kard threshold: stop at the threshold (kards finish it) or buy all the way
 * to max. Stored only when it differs from the rarity's goal. Realm Klash gear is always bought to max, so it gets
 * a label instead of a choice (see isRealmKlashName), and so does a card marked No kards (see cardGoal).
 */
function GoalSelect({ rule, card, onChange }: { rule: RarityRule; card: Card; onChange: (v: Card['goal']) => void }) {
  if (rule.fusionUpThreshold == null) return null;
  // Gear always has the choice. A character has it while its rarity tracks only to the threshold (where one entered past
  // it shows its Max: see entryGoal), or while its own goal is F3 on a rarity tracked to Max, so that can be cleared. A Max
  // of its own there is the rarity's anyway, and offering F3 would let one tap remove a character at F3 or above.
  if (rule.kind !== 'equipment' && rule.goal !== 'threshold' && card.goal !== 'threshold') return null;
  if (rule.kind === 'equipment' && isRealmKlashName(card.name)) return <span className={`${check} text-muted`}>Realm Klash gear (bought to {levelLabel(rule, maxFusion(rule))} with Blood Rubies)</span>;
  // Kards can't finish a card that can't take them, so it's always worked toward max (see cardGoal).
  if (card.noKards) return <span className={`${check} text-muted`}>Goal: Max ({levelLabel(rule, targetLevel(card, rule))}), no kards</span>;
  // Max is the card's own: a Gold card capped at A5 goes to A5.
  const max = levelLabel(rule, targetLevel({ ...card, goal: 'max' }, rule));
  return (
    <label className={check}>
      Goal
      <select value={card.goal ?? rule.goal} onChange={(e) => onChange(e.target.value === rule.goal ? undefined : (e.target.value as Card['goal']))}>
        <option value="threshold">F{rule.fusionUpThreshold} (Kards finish it)</option>
        <option value="max">{`Max (${max})`}</option>
      </select>
    </label>
  );
}

/**
 * The form's Goal for a card Add would save. `hasChoice`: this card's Goal can be F3 or Max (gear, or a character rarity
 * tracked to its kard threshold; not Realm Klash gear, always max), so the form shows a Goal box, and only then does the
 * Goal picked count. A card entered at or past the threshold goes on to its max (entryGoal): `fixed` is then true, and
 * the box shows Max as a label instead of the choice.
 */
function formGoal(card: Card, rule: RarityRule) {
  const hasChoice = rule.fusionUpThreshold != null && (rule.kind === 'equipment' || rule.goal === 'threshold') && !(rule.kind === 'equipment' && isRealmKlashName(card.name));
  const goal = entryGoal({ ...card, goal: hasChoice ? card.goal : undefined }, rule);
  return { goal, hasChoice, fixed: hasChoice && card.fusion >= (thresholdLevel(rule) ?? Infinity) };
}

/** Add card's Goal box: the choice, or a fixed label once the level picked decides the goal (see formGoal). */
function FormGoal({ card, rule, onChange }: { card: Card; rule: RarityRule; onChange: (v: Card['goal']) => void }) {
  const { goal, fixed } = formGoal(card, rule);
  if (!fixed) return <GoalSelect rule={rule} card={{ ...card, goal }} onChange={onChange} />;
  return (
    <span className={`${check} text-muted`}>Goal: Max ({levelLabel(rule, targetLevel({ ...card, goal: 'max' }, rule))})</span>
  );
}

/** Add card's note on the goal Add would save (see formGoal): done at once (Add is greyed out), tracked on past F3, or stopping at F3. */
function goalNote(card: Card, rule: RarityRule) {
  const { goal, hasChoice, fixed } = formGoal(card, rule);
  const saved = { ...card, goal };
  if (isMaxed(saved, rule)) return "That level is already the card's goal, so it would be done at once: pick a lower level to add it.";
  if (!hasChoice) return null;
  if (fixed) return `Already at F${rule.fusionUpThreshold} or past it, so this one is tracked on to ${levelLabel(rule, targetLevel(saved, rule))}.`;
  if (cardGoal(saved, rule) !== 'threshold') return null;
  // Its own Goal of F3 on a rarity tracked to Max is about this card, not the rarity.
  const who = goal === 'threshold' ? 'This card' : rule.label;
  return `${who} is tracked only until F${rule.fusionUpThreshold}. After that, your Fusion Up Kards can max it.`;
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
  // when an empty box opens (to the one the form shows) or a rarity is picked in the box above (`pick` counts those,
  // even while the box is closed), not when a sync removes it and the form shows the first rarity instead.
  const [known, setKnown] = useState(state.rarities);
  const rarities = useMemo(() => [...state.rarities, ...known.filter((r) => !state.rarities.some((x) => x.id === r.id && x.label === r.label))], [state.rarities, known]);
  const [start, setStart] = useState({ pick, id: startRarityId });
  // A box opened with no rarities follows the first one a sync brings in, or its plain lines would have none. The
  // rarity it moves to is remembered, so a sync that removes it before the next keystroke (one a sync brought in and
  // then picked above, say) still has its lines listed as skipped.
  if (start.pick !== pick || (!start.id && startRarityId)) {
    setKnown(rarities);
    setStart({ pick, id: startRarityId });
  }
  const remember = () => setKnown(rarities);
  // After an Add that left lines behind, the box stays until Done. A card that Add saved at its goal is deleted at once
  // as done, so its line would read as new again: it's left out (`gone`). The other cards Add saved now match the list
  // and aren't listed as skipped (`justAdded`) until the list is edited, when they read as already listed like any other.
  // An Undo, a delete or a sync offers their lines again (as new, or as an update).
  const [leftOver, setLeftOver] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const savedKeys = useMemo(() => (justAdded.size ? new Set(state.cards.map((c) => cardKey(c.rarityId, c.name))) : new Set<string>()), [justAdded, state.cards]);
  const parsed = useMemo(() => parseCardList(text, rarities, start.id, state.cards), [text, rarities, start.id, state.cards]);
  const live = (rarityId: string) => state.rarities.some((r) => r.id === rarityId);
  // Only a rarity the list knew: with no rarities at all, plain lines have none, and the Settings note covers them.
  const isRemoved = (c: (typeof parsed.cards)[number]) => !live(c.rarityId) && rarities.some((r) => r.id === c.rarityId);
  // An update to a card a sync left without its rarity can't be saved (there are no rules to check its goal against), so
  // it's skipped with the other lines whose rarity has gone, not offered as an update that does nothing.
  const isOrphan = (u: (typeof parsed.updates)[number]) => state.cards.some((c) => c.id === u.cardId && !live(c.rarityId));
  const updates = parsed.updates.filter((u) => !isOrphan(u));
  const removedLines = [...parsed.cards.filter(isRemoved).map((c) => c.line), ...parsed.updates.filter(isOrphan).map((u) => u.line)];
  // A card on the Maxed record is maxed, at whatever level its line gives (a roster, or a pack's drops): skipped. Only a
  // Stage line brings one back, as the game does when an update makes a Gold card ascendable.
  const isMaxedLine = (c: (typeof parsed.cards)[number]) => c.maxLevel === undefined && onMaxedRecord(state, c);
  // `gone` holds each line as typed with the card it was for, so an edited line (a lower level, say) is offered again,
  // and a line that reads differently once its card is gone (a Stage line brings a maxed card back) still matches.
  const isGone = (c: (typeof parsed.cards)[number]) => gone.has(`${cardKey(c.rarityId, c.name)}|${c.line}`);
  // Not the lines Add just saved at their top level: those went on the record, so they aren't "skipped".
  const maxedLines = parsed.cards.filter((c) => live(c.rarityId) && !isGone(c) && isMaxedLine(c));
  const newCards = parsed.cards.filter((c) => live(c.rarityId) && !isGone(c) && !isMaxedLine(c));
  const counts = state.rarities
    .map((r) => ({ label: r.label, n: newCards.filter((c) => c.rarityId === r.id).length }))
    .filter((x) => x.n > 0);

  if (!open) {
    return (
      <div className={actions}>
        {/* A new list starts from the rarities as they are now: one removed before it was opened isn't a rarity to it. Text
            kept by Cancel keeps the rarities and the rarity picked above it was typed with, so a heading or a plain line
            whose rarity a sync removed meanwhile is still skipped. A rarity picked above since still moves it (`pick`). */}
        <button onClick={() => (text ? remember() : (setKnown(state.rarities), setStart({ pick, id: startRarityId })), setOpen(true))}>Paste a list…</button>
      </div>
    );
  }

  const total = newCards.length + updates.length;
  // Each card Add just saved hides one of its lines from Skipped (a line pasted twice still lists its second copy), until
  // it's gone or its line is offered again (an Undo, a delete or a sync), when its other copies read as skipped again.
  const offered = new Set([
    ...newCards.map((c) => cardKey(c.rarityId, c.name)),
    ...updates.flatMap((u) => state.cards.filter((c) => c.id === u.cardId).map((c) => cardKey(c.rarityId, c.name))),
  ]);
  const pending = new Set([...justAdded].filter((k) => !offered.has(k) && savedKeys.has(k)));
  const skipped = parsed.duplicates.filter((x) => !pending.delete(x.key)).map((x) => x.name);
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
        // Nor one on the Maxed record without a Stage, a sync's entry included.
        const cards = newCards.filter((c) => d.rarities.some((r) => r.id === c.rarityId) && !have.has(cardKey(c.rarityId, c.name)) && !(c.maxLevel === undefined && onMaxedRecord(d, c)));
        // As Add card does: a level a sync has since taken off the rarity is saved as not owned.
        const levelOf = (c: (typeof newCards)[number]) => ((c.fusion ?? 0) <= maxFusion(d.rarities.find((r) => r.id === c.rarityId)!) ? (c.fusion ?? 0) : 0);
        // Nor to a card left without its rarity (an older build or an imported file can leave one): it has no rules to
        // check its goal against. Nor one a sync has already updated that way (the same list pasted on another device).
        // A tower in other capitals is the same tower (towerKey), as the list was read with: one a sync already gave the
        // card, in the Tower list's spelling, isn't a change.
        const changes = (c: Card, patch: (typeof updates)[number]['patch']) =>
          Object.entries(patch).some(([k, v]) =>
            k === 'maxLevel' ? (c.maxLevel ?? null) !== v : k === 'sourceNote' ? towerKey(c.sourceNote ?? '') !== towerKey((v as string | undefined) ?? '') : c[k as keyof typeof patch] !== v,
          );
        const saving = updates.flatMap((u) =>
          d.cards
            .filter((c) => c.id === u.cardId && d.rarities.some((r) => r.id === c.rarityId) && changes(c, u.patch))
            .map((c) => ({ c, patch: u.patch, line: u.line })),
        );
        if (!cards.length && !saving.length) return noChange;
        // A pasted tower is saved as the Tower list spells it (one tower however it's typed), so a pasted line can't bring
        // a second spelling back; a tower no card names yet takes the spelling of the first new card naming it, or failing
        // that the first updated one.
        const spellings = towerSpellings(d);
        const listSpelling = (note: string) => {
          if (!spellings.has(towerKey(note))) spellings.set(towerKey(note), towerName(note));
          return spellings.get(towerKey(note))!;
        };
        const fresh = cards.map(
          (c): Card => ({
            id: newId(),
            name: c.name,
            rarityId: c.rarityId,
            fusion: levelOf(c),
            guest: false,
            source: c.source ?? initialSource(c, d.rarities),
            ...(c.sourceNote && { sourceNote: listSpelling(c.sourceNote) }),
            ...(c.maxLevel != null && { maxLevel: c.maxLevel }),
          }),
        );
        // As Add card does: one pasted at or past its kard threshold, while tracked only that far, goes on to its max.
        for (const f of fresh) {
          const goal = entryGoal(f, d.rarities.find((r) => r.id === f.rarityId)!);
          if (goal) f.goal = goal;
        }
        const ruleOf = (c: Card) => d.rarities.find((r) => r.id === c.rarityId)!;
        d.cards.push(...fresh);
        // One pasted already maxed goes on the record with no day (when it was maxed isn't known). One pasted back with a
        // Stage (a Gold card made ascendable) comes off it, since it has copies to go again.
        recordMaxed(d, fresh.filter((f) => atTopLevel(f, ruleOf(f))));
        unmarkMaxed(d, fresh.filter((f, i) => cards[i].maxLevel !== undefined && !atTopLevel(f, ruleOf(f))));
        for (const { c, patch } of saving) Object.assign(c, patch.sourceNote ? { ...patch, sourceNote: listSpelling(patch.sourceNote) } : patch);
        added = cards.length;
        updated = saving.length;
        const touched = [...fresh, ...saving.map(({ c }) => c)];
        saved = touched.map((c) => cardKey(c.rarityId, c.name));
        // At their goal now, so the save deletes them as done: their lines are left out from then on.
        done = [
          ...cards.filter((_, i) => isMaxed(fresh[i], ruleOf(fresh[i]))).map((c) => `${cardKey(c.rarityId, c.name)}|${c.line}`),
          ...saving.filter(({ c }) => isMaxed(c, ruleOf(c))).map(({ c, line }) => `${cardKey(c.rarityId, c.name)}|${line}`),
        ];
      },
      () => {
        const label = [added && `added ${added} card${added === 1 ? '' : 's'}`, updated && `updated ${updated}`].filter(Boolean).join(', ');
        return label.charAt(0).toUpperCase() + label.slice(1);
      },
    );
    // A list with lines Add couldn't use (a sync left them nowhere to go or had already added or updated them, a line it
    // can't read, or one under a rarity since removed) stays, so they aren't lost, and Done clears the box. Lines that
    // were already listed when Add was tapped don't keep it open.
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
        {maxedLines.length > 0 && ` · skipping ${maxedLines.length} already maxed (${maxedLines.map((c) => c.name).join('; ')})`}
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

/** Which of the Cards tab's pages is showing. App holds it, so tapping the Cards tab again can switch it. */
export type CardsPage = 'cards' | 'towers' | 'maxed';

export default function CardsView({ sub, onSub }: { sub: CardsPage; onSub: (sub: CardsPage) => void }) {
  return (
    <>
      <div className="flex mb-[0.8rem] border border-line rounded-panel overflow-hidden">
        <button className={segment(sub === 'cards')} onClick={() => onSub('cards')} aria-pressed={sub === 'cards'}>
          <CardsIcon size={18} />
          Cards
        </button>
        <button className={segment(sub === 'towers')} onClick={() => onSub('towers')} aria-pressed={sub === 'towers'}>
          <TowerIcon size={18} />
          Tower gear
        </button>
        <button className={segment(sub === 'maxed')} onClick={() => onSub('maxed')} aria-pressed={sub === 'maxed'}>
          <TrophyIcon size={18} />
          Maxed
        </button>
      </div>
      {/*
        Each keeps its state, so switching pages keeps a half-typed card, a pasted list or a search on the card list.
        Activity hides the other page: it still redraws, at low priority, but its effects (like the catalog download) wait
        until it's shown.
      */}
      <Activity mode={sub === 'cards' ? 'visible' : 'hidden'}>
        <CardList />
      </Activity>
      <Activity mode={sub === 'towers' ? 'visible' : 'hidden'}>
        <TowersPanel />
      </Activity>
      <Activity mode={sub === 'maxed' ? 'visible' : 'hidden'}>
        <MaxedPanel />
      </Activity>
    </>
  );
}

// No min-w-0: each segment stays at least as wide as its longest word, so with large text the labels wrap under their
// icons instead of spilling into each other. Phones stack the icon over the label; wider screens put it beside.
const segment = (active: boolean) => `flex-1 inline-flex flex-col items-center justify-center gap-[0.15rem] md:flex-row md:gap-[0.4rem] text-center md:whitespace-nowrap border-0 rounded-none focus-visible:-outline-offset-2 ${active ? 'bg-red-dim text-fg' : 'bg-panel text-muted hover:text-fg'}`;

const CARD_SORTS = ['rarity', 'fusion-high', 'fusion-low', 'name'] as const;
type CardSort = (typeof CARD_SORTS)[number];

function CardList() {
  const { state, update } = useStore();
  const { now, ctx } = usePlan();
  // Each tower your gear names, spelled as the first card naming it has it (towerSpellings), so "lin kuei tower" isn't
  // offered beside "Lin Kuei Tower". Cards under a rarity a sync removed are hidden everywhere, so they don't count.
  const { cards: allCards, rarities } = state;
  const spellings = useMemo(() => towerSpellings({ cards: allCards, rarities }), [allCards, rarities]);
  // The Tower list, A to Z.
  const towers = useMemo(() => [...spellings.values()].sort((a, b) => a.localeCompare(b)), [spellings]);
  // A card's chip names its tower as the Tower list spells it, so one row doesn't show it two ways.
  const towerLabel = (note: string) => spellings.get(towerKey(note)) ?? note.trim();
  // Where Add card's Tower box shows its re-spell hint (TowerSelect's hintIn).
  const [towerHintAt, setTowerHintAt] = useState<HTMLElement | null>(null);
  const events = useEvents();
  const [rarity, setRarity] = useState<string>('all');
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<Source | 'all'>('all');
  const [ownedFilter, setOwnedFilter] = useState<'all' | 'owned' | 'unowned'>('all');
  // Cards whose level was tapped while the Owned filter was on stay listed until it changes, so one tapped from not owned
  // to owned (or back) doesn't vanish, with no Undo, before it can be tapped back. A new search starts afresh too.
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  const pickOwned = (v: typeof ownedFilter) => (setOwnedFilter(v), setTapped(new Set()));
  const [sortBy, setSortBy] = useDeviceChoice('mkmax:cardSort', CARD_SORTS);
  /**
   * The card being renamed, its name before (which comes back if the name is cleared), what's in the box, and the name
   * this rename last saved (each keystroke that isn't blank is saved as it's typed), the only name finishing it writes
   * over. A blank box isn't saved, so a card never syncs with no name.
   */
  const [renaming, setRenaming] = useState<{ id: string; was: string; text: string; saved: string } | null>(null);
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
  // The rarity picked, or the first once a sync has removed that one (the box shows the first). Falling back starts that
  // rarity's level, goal and cap at their defaults, since the removed rarity's don't fit it (a Gold A2 would be saved at a
  // Diamond's max and deleted at once as maxed).
  const onRarity = !draftRule || draftRule.id === draft.rarityId ? draft : { ...draft, rarityId: draftRule.id, fusion: 0, maxLevel: null, goal: undefined };
  // What the form shows, and Add card saves. A level a sync has since taken off the rarity shows, and is saved, as not
  // owned, so the Goal and note match it too; so does any level once a sync makes the rarity a Kameo (its level box hides).
  const shown = draftRule && (onRarity.fusion > maxFusion(draftRule) || maxFusion(draftRule) <= 1) ? { ...onRarity, fusion: 0 } : onRarity;
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

  // The count first, so it still shows when a phone cuts the Undo bar short.
  const respelledLabel = (tower: string | undefined, n: number) => `Fixed the spelling on ${n} other card${n === 1 ? '' : 's'}: ${tower}`;
  // With `over`, only over that tower: a Tower box left empty doesn't put its old tower back over one a sync brought in.
  // A finished typed name in a new spelling also re-spells the tower on the other cards naming it; that changes cards the
  // user didn't touch, so it has Undo even though typing doesn't. The box saved this card as it was typed, so Undo also
  // puts this card back to the tower the box goes back to.
  const setTower = (id: string, tower: string | undefined, over?: TowerOver, undoLabel?: string) => {
    let respelled = 0;
    update(
      (d) => {
        const c = d.cards.find((x) => x.id === id);
        // Nor on a card a sync took off tower gear: its list going away settles a held step or finishes its box.
        if (!c || c.source !== 'tower' || (over && c.sourceNote !== over.saved)) return noChange;
        respelled = over?.respell && tower ? respellTower(d, tower, c) : 0;
        if (c.sourceNote === tower && !respelled) return noChange;
        c.sourceNote = tower;
      },
      () => (respelled ? respelledLabel(tower, respelled) : (undoLabel ?? '')),
      over?.respell
        ? {
            undoFrom: (p) => {
              const typedOn = respelled ? p.cards.find((x) => x.id === id) : undefined;
              if (typedOn) typedOn.sourceNote = over.was;
            },
          }
        : undefined,
    );
  };

  // Add card's Tower box fixes a tower's spelling on the cards naming it when a name typed there is finished, as a card's
  // own box does, with Undo; Add then saves the card with that spelling.
  const respellFromAdd = (tower: string) => {
    let respelled = 0;
    update(
      (d) => {
        respelled = respellTower(d, tower);
        return respelled ? undefined : noChange;
      },
      () => respelledLabel(tower, respelled),
    );
  };

  // Saved on the card as it is now. Unticking keeps a card at or past F3 on Max, as when one is entered there (see
  // entryGoal); otherwise a piece tracked only to F3 would be removed as done the moment kards were allowed again.
  const setNoKards = (c: Card, on: boolean) =>
    update(
      (d) => {
        const x = d.cards.find((y) => y.id === c.id);
        const r = x && d.rarities.find((y) => y.id === x.rarityId);
        if (!x || !r || !!x.noKards === on) return noChange;
        if (on) x.noKards = true;
        else {
          delete x.noKards;
          const goal = entryGoal(x, r);
          if (goal !== x.goal) x.goal = goal;
        }
      },
      on ? `${c.name}: no Fusion Up Kards` : `${c.name}: Fusion Up Kards allowed`,
    );

  // A level tap steps from the level it showed: saving that level ± 1 would undo a level a sync has added since.
  const stepLevel = (c: Card, by: 1 | -1) => {
    if (ownedFilter !== 'all' && !tapped.has(c.id)) setTapped(new Set([...tapped, c.id]));
    update((d) => (d.cards.find((x) => x.id === c.id)?.fusion === c.fusion && stepCard(d, c.id, by) ? undefined : noChange));
  };

  /** Fuse one level with Fusion Up Kards from the Wallet, as done in the game: the step the button showed, or none. */
  function fuse(c: Card, cost: number) {
    update((d) => (fuseWithKards(d, c.id, cost, c.fusion) == null ? noChange : undefined), `Used ${cost} Fusion Up Kard${cost === 1 ? '' : 's'} on ${c.name}`);
  }

  // gstack-shortcut(dec-6a428b1f): a card renamed onto a name on the Maxed record stays on it while listed (Remove on Maxed
  // fixes it), upgrade when renames stop saving as they're typed or completion is reported counting a listed card.
  function rename(c: Card, text: string) {
    const saved = text.trim() ? text : (renaming?.saved ?? c.name);
    setRenaming({ id: c.id, was: renaming?.was ?? c.name, text, saved });
    if (text.trim()) patch(c.id, { name: text });
  }

  // A rename ends with the name trimmed, and a cleared name goes back to the one it had, so there's always something to
  // tap to rename the card again. Only over the name this rename last saved: one a sync brought in since stands.
  const saveRename = (r: NonNullable<typeof renaming>) => {
    const name = r.text.trim() || r.was.trim();
    update((d) => {
      const c = d.cards.find((x) => x.id === r.id);
      if (!c || !name || c.name !== r.saved || c.name === name) return noChange;
      c.name = name;
    });
  };

  // Hiding this page (Activity, for Tower gear) or leaving the tab may give the box no blur, so a rename left open is
  // saved in the cleanup. Its box is closed when the page is shown again, as that effect runs then; a page left for
  // another tab is gone, with nothing to close.
  const openRename = useRef(renaming);
  useEffect(() => void (openRename.current = renaming));
  useEffect(() => {
    if (openRename.current) setRenaming(null);
    return () => {
      if (openRename.current) saveRename(openRename.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishRename() {
    if (renaming) saveRename(renaming);
    setRenaming(null);
  }

  function add() {
    if (!shown.name.trim()) return;
    let added = false;
    // Adding a card has no Undo of its own, but any Undo showing goes back to before it, so would take it out too: the
    // Add carries on from that Undo (alsoUndo), and the bar names the card first ("Added Ice Fan · …").
    update(
      (d) => {
        // Not under a rarity a sync removed after the form was drawn: the card would be hidden everywhere, with no way to
        // delete it. Its kind and steps come from the rarity as it is now.
        const rule = d.rarities.find((r) => r.id === shown.rarityId);
        if (!rule) return noChange;
        const isEquip = rule.kind === 'equipment';
        const typed = isEquip && shown.source === 'tower' ? towerName(shown.sourceNote ?? '') || undefined : undefined;
        // As the list spells it now (a spelling typed in the box was fixed on the other cards when the box was finished),
        // so an Add never puts an old spelling back, even one kept from the last card after a fix or a sync.
        const tower = typed && (towerSpellings(d).get(towerKey(typed)) ?? typed);
        const card: Card = {
          id: newId(),
          ...shown,
          name: shown.name.trim(),
          // Not a level a sync took off the rarity after the form was drawn either (the form's own clamp is on `shown`).
          fusion: shown.fusion <= maxFusion(rule) ? shown.fusion : 0,
          guest: rule.hasGuests && shown.guest,
          source: isEquip ? shown.source : initialSource(shown, d.rarities),
          sourceNote: tower || undefined,
        };
        // The goal the form showed for it (see formGoal), worked out with the rarity as it is now. A card already at it would
        // be done at once, so it isn't added (Add is greyed out for it; Enter in the name box comes here too).
        const saved = { ...card, goal: formGoal(card, rule).goal };
        // Nor a card on the Maxed record (Add is greyed out for that too).
        if (isMaxed(saved, rule) || onMaxedRecord(d, saved)) return noChange;
        d.cards.push(saved);
        added = true;
      },
      `Added ${shown.name.trim()}`,
      { alsoUndo: true },
    );
    // The typed name stays for another try when nothing was added.
    if (added) setDraft({ ...shown, name: '', fusion: 0, guest: false });
  }

  const rarityOrder = (c: Card) => (sortBy === 'name' ? 0 : state.rarities.findIndex((r) => r.id === c.rarityId));
  // Stored levels compare across rarities: F0 is 1 everywhere, and Gold ascension (A1+) comes after F10.
  const fusionOrder = (a: Card, b: Card) => (sortBy === 'fusion-high' ? b.fusion - a.fusion : sortBy === 'fusion-low' ? a.fusion - b.fusion : 0);
  // "kind:equipment" etc. groups every rarity of that kind (Diamond + Gold characters, all gear, both Kameo tiers).
  const inRarity = (c: Card, value: string) => value === 'all' || c.rarityId === value || value === `kind:${state.rarities.find((r) => r.id === c.rarityId)?.kind}`;
  const inSource = (c: Card, value: Source | 'all') => value === 'all' || (c.source ?? '') === value;
  const inOwned = (c: Card, value: typeof ownedFilter) => value === 'all' || (value === 'owned') === c.fusion > 0;
  // The card being renamed stays listed even if its new name no longer matches the search.
  const matchesSearch = (c: Card) => !q || c.id === renaming?.id || c.name.toLowerCase().includes(q.toLowerCase());
  // Listed under the Owned filter picked: a card tapped while it's on stays listed (see `tapped`).
  const shownOwned = (c: Card) => inOwned(c, ownedFilter) || tapped.has(c.id);
  // Each filter option shows how many cards it would list, given the search and the other filters, tapped cards kept
  // listed included, so the Owned option picked counts the rows on screen.
  const rarityCount = (value: string) => state.cards.filter((c) => matchesSearch(c) && inSource(c, sourceFilter) && shownOwned(c) && inRarity(c, value)).length;
  const sourceCount = (value: Source | 'all') => state.cards.filter((c) => matchesSearch(c) && inRarity(c, rarity) && shownOwned(c) && inSource(c, value)).length;
  const ownedCount = (value: typeof ownedFilter) =>
    state.cards.filter((c) => matchesSearch(c) && inRarity(c, rarity) && inSource(c, sourceFilter) && (value === ownedFilter ? shownOwned(c) : inOwned(c, value))).length;
  const addsMaxed = !!shown.name.trim() && !!draftRule && onMaxedRecord(state, { name: shown.name.trim(), rarityId: draftRule.id });
  const cards = state.cards
    .filter((c) => matchesSearch(c) && inRarity(c, rarity) && inSource(c, sourceFilter) && shownOwned(c))
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
            <select value={shown.rarityId} onChange={(e) => (setDraft({ ...shown, rarityId: e.target.value, fusion: 0, maxLevel: null, goal: undefined }), setPicks((n) => n + 1))}>
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
          {draftRule && <FormGoal card={shown as Card} rule={draftRule} onChange={(v) => setDraft({ ...shown, goal: v })} />}
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
              <TowerSelect
                towers={towers}
                value={shown.sourceNote}
                onChange={(v, over) => {
                  setDraft({ ...shown, sourceNote: v });
                  if (over?.respell && v) respellFromAdd(v);
                }}
                onEnter={add}
                respells={(t) => towerRespells(state, t)}
                hintIn={towerHintAt}
              />
            </label>
          )}
          <button className={`${btn.primary} md:-col-end-1`} onClick={add} disabled={!shown.name.trim() || (!!draftRule && isMaxed({ ...(shown as Card), goal: formGoal(shown as Card, draftRule).goal }, draftRule)) || addsMaxed}>
            Add
          </button>
        </div>
        {/* Add card's Tower hint shows here, among the form's notes, where it can't move the box being typed in. */}
        <div ref={setTowerHintAt} className="contents" />
        {draft.rarityId && draftRule && draftRule.id !== draft.rarityId && (
          <p className="text-muted text-small">The rarity picked here has since been removed, so this card goes in as {draftRule.label}.</p>
        )}
        {/* A card on the Maxed record gets only its own note: a lower level wouldn't add it either. */}
        {draftRule && !addsMaxed && goalNote(shown as Card, draftRule) && <p className="text-muted text-small md:max-w-[80ch]">{goalNote(shown as Card, draftRule)}</p>}
        {addsMaxed && <p className="text-muted text-small md:max-w-[80ch]">{onMaxedNote(draftRule)}</p>}
        <PasteList pick={picks} startRarityId={draftRule?.id ?? ''} />
      </section>

      {/* Kept in view while scrolling a long list on wide screens, where it fits on one row; elsewhere it scrolls away as before. */}
      <div className="flex flex-wrap gap-2 mb-[0.8rem] items-center xl:sticky xl:top-0 xl:z-[2] xl:bg-bg xl:py-2">
        <input className="flex-1 min-w-0 md:min-w-[200px] md:max-w-[360px]" placeholder="Search…" value={q} onChange={(e) => (setQ(e.target.value), setTapped(new Set()))} />
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
        <select value={ownedFilter} onChange={(e) => pickOwned(e.target.value as typeof ownedFilter)} aria-label="Filter by owned">
          <option value="all">{`Owned or not (${ownedCount('all')})`}</option>
          <option value="unowned">{`Not owned (${ownedCount('unowned')})`}</option>
          <option value="owned">{`Owned (${ownedCount('owned')})`}</option>
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
                    <input value={renaming.text} autoFocus onChange={(e) => rename(c, e.target.value)} onBlur={finishRename} onKeyDown={(e) => e.key === 'Enter' && finishRename()} />
                  ) : (
                    <div className={`${rowTitle} hover:underline decoration-muted underline-offset-2 md:cursor-pointer`} onClick={() => setRenaming({ id: c.id, was: c.name, text: c.name, saved: c.name })} title="Tap to rename">
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
                    {c.source && <Chip tone="source">{SOURCE_LABELS[c.source]}{c.source === 'tower' && c.sourceNote?.trim() && `: ${towerLabel(c.sourceNote)}`}</Chip>}
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
                <GoalSelect rule={rule} card={c} onChange={(v) => patch(c.id, { goal: v })} />
                <CapSelect rule={rule} value={c.maxLevel} onChange={(v) => patch(c.id, { maxLevel: v })} />
                {rule.hasGuests && (
                  <label className={check}>
                    <input type="checkbox" checked={c.guest} onChange={(e) => patch(c.id, { guest: e.target.checked })} />
                    Guest
                  </label>
                )}
                {/* Only where kards apply: Realm Klash gear never takes them anyway. A card left marked (on a rarity without
                    kards, or renamed to a Realm Klash piece) still shows the box, so it can be unticked. */}
                {(c.noKards || (rule.fusionUpThreshold != null && !(rule.kind === 'equipment' && isRealmKlashName(c.name)))) && (
                  <label className={check} title="The game won't take Fusion Up Kards on this card, so every copy comes from packs">
                    <input type="checkbox" checked={!!c.noKards} onChange={(e) => setNoKards(c, e.target.checked)} />
                    No kards
                  </label>
                )}
                {(rule.kind !== 'character' || c.source) && <SourceSelect kind={rule.kind} value={c.source} onChange={(v) => patch(c.id, { source: v, sourceNote: undefined })} />}
                {c.source === 'tower' && <TowerSelect className="w-[11rem] md:w-[19rem]" placeholder="Tower name" towers={towers} value={c.sourceNote} respells={(t) => towerRespells(state, t, c.id)} onChange={(v, over) => setTower(c.id, v, over)} onPick={(v) => setTower(c.id, v, undefined, v ? `${c.name}: tower set to ${v}` : `${c.name}: tower removed`)} />}
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
