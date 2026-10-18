import { useEffect, useMemo, useRef, useState } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { maxedKeys, recordMaxed } from '../engine';
import { completion, findInCatalog, loadCatalog, type CatalogItem } from '../catalog';
import { cardKey, parseCardList } from '../cardList';
import { CardThumb, ConfirmButton, RarityBadge, dayLabel } from '../ui';
import { actions, btn, card, field, grow, row, rowTitle, subpanel } from '../classes';
import type { MaxedCard } from '../types';

/** Whole percent, rounded down so a rarity reads 100% only once every card is maxed. */
const percent = (n: number, of: number) => (of ? Math.floor((n / of) * 100) : 0);

/**
 * The same value while `key` is unchanged. Every change copies the whole save (store.tsx), so the record and rarities
 * are new arrays after any tap; matching them against the catalog again is only needed when they actually change.
 */
function useSame<T>(value: T, key: string): T {
  const ref = useRef({ key, value });
  if (ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}

/**
 * The Maxed record: cards that reached their top level and left the card list, and how much of each rarity MK Mobile
 * Base lists that makes. Completion needs the catalog, so it shows once that has loaded.
 */
export default function MaxedPanel() {
  const { state, update } = useStore();
  const { now } = usePlan();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  // Bumped by Try again: loadCatalog forgets a failed download, so loading again fetches it again.
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(
      (items) => !cancelled && setCatalog(items),
      () => !cancelled && setCatalogFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const maxed = useSame(state.maxed ?? [], (state.maxed ?? []).map((m) => `${m.rarityId}|${m.name}|${m.at ?? ''}`).join('\n'));
  const rarities = useSame(state.rarities, JSON.stringify(state.rarities));
  const done = useMemo(() => (catalog ? completion(maxed, rarities, catalog) : null), [catalog, maxed, rarities]);
  const counted = done ? done.rarities.reduce((n, r) => n + r.maxed, 0) : 0;
  const total = done ? done.rarities.reduce((n, r) => n + r.total, 0) : 0;
  // Each entry with its key, rule and art (from the catalog, as the record keeps only a name and rarity), by rarity then
  // name: worked out once per record, not on every redraw.
  const sorted = useMemo(() => {
    const order = new Map(rarities.map((r, i) => [r.id, i]));
    return maxed
      .map((m) => {
        const rule = rarities.find((r) => r.id === m.rarityId);
        const image = catalog && rule ? findInCatalog({ id: '', name: m.name, rarityId: m.rarityId, fusion: 0, guest: false }, rule, catalog)?.image : undefined;
        return { m, key: cardKey(m.rarityId, m.name), rule, image };
      })
      .sort((a, b) => (order.get(a.m.rarityId) ?? -1) - (order.get(b.m.rarityId) ?? -1) || a.m.name.localeCompare(b.m.name));
  }, [catalog, maxed, rarities]);
  const listed = useMemo(() => (q ? sorted.filter(({ m }) => m.name.toLowerCase().includes(q.toLowerCase())) : sorted), [sorted, q]);

  // Found by rarity and name rather than by its place in the list, so a tap after a sync changed the list removes the
  // card it was for, or nothing.
  const remove = (m: MaxedCard) =>
    update(
      (d) => {
        const before = d.maxed?.length ?? 0;
        d.maxed = (d.maxed ?? []).filter((x) => cardKey(x.rarityId, x.name) !== cardKey(m.rarityId, m.name));
        if (d.maxed.length === before) return noChange;
      },
      `Removed ${m.name} from Maxed`,
    );

  return (
    <>
      <section className={card}>
        <h2>Completion</h2>
        {!done && !catalogFailed && <p className="text-muted text-small">Loading MK Mobile Base's card list…</p>}
        {!done && catalogFailed && (
          <>
            <p className="text-muted text-small">MK Mobile Base's card list didn't load, so completion can't be worked out yet.</p>
            <div className={actions}>
              <button onClick={() => (setCatalogFailed(false), setAttempt((n) => n + 1))}>Try again</button>
            </div>
          </>
        )}
        {done && (
          <>
            <p>
              <b>{percent(counted, total)}%</b> of every card MK Mobile Base lists: {counted} of {total} maxed.
            </p>
            {done.rarities.map((r) => (
              <div key={r.rarityId} className={`${row} items-center`}>
                <div className={grow}>
                  <RarityBadge rule={rarities.find((x) => x.id === r.rarityId)} />
                </div>
                <span className="text-muted text-small">
                  {r.maxed} of {r.total}
                </span>
                <b className="min-w-[3.5rem] text-right">{percent(r.maxed, r.total)}%</b>
              </div>
            ))}
            {done.unlisted.length > 0 && (
              <p className="text-muted text-small">
                {done.unlisted.length === 1 ? "1 maxed card isn't" : `${done.unlisted.length} maxed cards aren't`} on MK Mobile Base's list under {done.unlisted.length === 1 ? 'its' : 'their'} rarity yet, so{' '}
                {done.unlisted.length === 1 ? "it isn't" : "they aren't"} counted: {done.unlisted.map((m) => m.name).join(', ')}.
              </p>
            )}
          </>
        )}
      </section>

      <section className={card}>
        <h2>
          Maxed cards <span className="text-muted text-small">{maxed.length}</span>
        </h2>
        <p className="text-muted text-small md:max-w-[80ch]">
          A card goes here when it reaches its top level (F10, or a Gold card's own cap) or, for a Kameo, when you own it. Gear the app stops tracking at F3 isn't maxed yet, so add it here once you've finished it in the game.
        </p>
        <PasteMaxed />
        {maxed.length > 0 && <input className="w-full md:max-w-[360px] my-[0.6rem]" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {maxed.length === 0 && <p className="text-muted">No maxed cards yet.</p>}
        {maxed.length > 0 && listed.length === 0 && <p className="text-muted">No maxed cards match.</p>}
        {listed.map(({ m, key, rule, image }) => (
          <div key={key} className={`${row} items-center`}>
            <CardThumb card={{ id: '', name: m.name, rarityId: m.rarityId, fusion: 0, guest: false, imageUrl: image }} rule={rule} size={36} />
            <div className={grow}>
              <div className={rowTitle}>{m.name}</div>
              <div className="text-small">
                <RarityBadge rule={rule} />
                {m.at && <span className="text-muted">{' '}maxed {dayLabel(m.at, now)}</span>}
              </div>
            </div>
            <ConfirmButton label="Remove" className={btn.ghost} onConfirm={() => remove(m)} />
          </div>
        ))}
      </section>
    </>
  );
}

/**
 * Adds cards maxed before the record existed, from a pasted list in Paste a list's format. Cards still in the card list
 * aren't maxed, so their lines are skipped, as are ones already on the record.
 */
function PasteMaxed() {
  const { state, update } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(state.rarities[0]?.id ?? '');
  // The rarity shown is the one plain lines go under: the first one once a sync has removed the one picked.
  const rarityId = state.rarities.some((r) => r.id === picked) ? picked : (state.rarities[0]?.id ?? '');
  const parsed = useMemo(() => parseCardList(text, state.rarities, rarityId, state.cards), [text, state.rarities, rarityId, state.cards]);

  if (!open) {
    return (
      <div className={actions}>
        <button onClick={() => setOpen(true)}>Paste maxed cards…</button>
      </div>
    );
  }

  // Only while the box is open: the page redraws on every change, hidden or not.
  const onRecord = maxedKeys(state);
  const inList = new Set(state.cards.map((c) => cardKey(c.rarityId, c.name)));
  const fresh = parsed.cards.filter((c) => !onRecord.has(cardKey(c.rarityId, c.name)));
  const already = parsed.cards.filter((c) => onRecord.has(cardKey(c.rarityId, c.name))).map((c) => c.name);
  const stillListed = [...parsed.updates.map((u) => u.name), ...parsed.duplicates.filter((d) => inList.has(d.key)).map((d) => d.name)];

  function add() {
    let added = 0;
    update(
      (d) => {
        // As the screen showed, checked against the save as it is now: not under a rarity a sync removed, nor a card a
        // sync has put back in the list.
        const have = new Set(d.cards.map((c) => cardKey(c.rarityId, c.name)));
        const before = d.maxed?.length ?? 0;
        recordMaxed(
          d,
          fresh.filter((c) => d.rarities.some((r) => r.id === c.rarityId) && !have.has(cardKey(c.rarityId, c.name))).map((c) => ({ name: c.name, rarityId: c.rarityId })),
        );
        added = (d.maxed?.length ?? 0) - before;
        if (!added) return noChange;
      },
      () => `Added ${added} to Maxed`,
    );
    // As Paste a list does: lines listed as skipped with a reason stay, so they can be fixed and added.
    if (added && !parsed.problems.length) {
      setText('');
      setOpen(false);
    }
  }

  // As Paste a list words it: what's new, then what's skipped.
  const status = [
    fresh.length ? `New: ${fresh.length}` : 'Nothing to add yet.',
    already.length > 0 && `skipping ${already.length} already on Maxed (${already.join('; ')})`,
    stillListed.length > 0 && `skipping ${stillListed.length} still in your card list, so not maxed yet (${stillListed.join('; ')})`,
  ].filter(Boolean);
  return (
    <div className={subpanel}>
      <p className="text-muted text-small md:max-w-[80ch]">
        One card per line, as in Paste a list: plain names go under the rarity picked here, a line that's just a rarity's name (like "Gold Kameo") switches it, or add a rarity after a name ("Kori Blade - Epic"). No level is needed and none is saved, though a line with a level the rarity doesn't have is skipped.
      </p>
      <label className={`${field} md:max-w-[240px]`}>
        <span>Rarity for plain names</span>
        <select value={rarityId} onChange={(e) => setPicked(e.target.value)}>
          {state.rarities.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Gold Kameo\nJade, Lizard\nKori Blade - Epic'} aria-label="Maxed cards" autoFocus />
      <div className="text-small text-muted">{status.join(' · ')}</div>
      {parsed.problems.length > 0 && (
        <ul className="list-disc pl-[40px] my-[1em] text-error text-small">
          {/* Keyed by place too: the same line can be pasted twice. */}
          {parsed.problems.map((p, i) => (
            <li key={`${i}|${p.line}`}>
              Skipped "{p.line}": {p.reason}.
            </li>
          ))}
        </ul>
      )}
      <div className={actions}>
        {/* As Paste a list does: Cancel closes the box and keeps the text for next time. */}
        <button onClick={() => setOpen(false)}>Cancel</button>
        <button className={btn.primary} onClick={add} disabled={fresh.length === 0}>
          {fresh.length ? `Add ${fresh.length}` : 'Add maxed cards'}
        </button>
      </div>
    </div>
  );
}
