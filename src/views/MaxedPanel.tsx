import { useEffect, useMemo, useState } from 'react';
import { noChange, useStore } from '../store';
import { recordMaxed } from '../engine';
import { completion, findInCatalog, loadCatalog, type CatalogItem } from '../catalog';
import { cardKey, parseCardList } from '../cardList';
import { CardThumb, RarityBadge } from '../ui';
import { actions, btn, card, grow, row, rowTitle } from '../classes';
import type { MaxedCard } from '../types';

/** Whole percent, rounded down so a rarity reads 100% only once every card is maxed. */
const percent = (n: number, of: number) => (of ? Math.floor((n / of) * 100) : 0);

/**
 * The Maxed record: cards that reached their top level and left the card list, and how much of each rarity MK Mobile
 * Base lists that makes. Completion needs the catalog, so it shows once that has loaded.
 */
export default function MaxedPanel() {
  const { state, update } = useStore();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
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
  }, []);

  const maxed = useMemo(() => state.maxed ?? [], [state.maxed]);
  const done = useMemo(() => (catalog ? completion(maxed, state.rarities, catalog) : null), [catalog, maxed, state.rarities]);
  const counted = done ? done.rarities.reduce((n, r) => n + r.maxed, 0) : 0;
  const total = done ? done.rarities.reduce((n, r) => n + r.total, 0) : 0;
  const ruleOf = (m: MaxedCard) => state.rarities.find((r) => r.id === m.rarityId);
  const order = (m: MaxedCard) => state.rarities.findIndex((r) => r.id === m.rarityId);
  const listed = maxed
    .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  // Art from the catalog, as the record keeps only a name and rarity.
  const imageOf = (m: MaxedCard) => {
    const rule = ruleOf(m);
    return catalog && rule ? findInCatalog({ id: '', name: m.name, rarityId: m.rarityId, fusion: 0, guest: false }, rule, catalog)?.image : undefined;
  };

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
        {!done && (
          <p className="text-muted text-small">
            {catalogFailed ? "MK Mobile Base's card list didn't load, so completion can't be worked out yet. Pull to refresh to try again." : "Loading MK Mobile Base's card list…"}
          </p>
        )}
        {done && (
          <>
            <p>
              <b>{percent(counted, total)}%</b> of every card MK Mobile Base lists: {counted} of {total} maxed.
            </p>
            {done.rarities.map((r) => {
              const rule = state.rarities.find((x) => x.id === r.rarityId);
              return (
                <div key={r.rarityId} className={`${row} items-center`}>
                  <div className={grow}>
                    <RarityBadge rule={rule} />
                  </div>
                  <span className="text-muted text-small">
                    {r.maxed} of {r.total}
                  </span>
                  <b className="min-w-[3.5rem] text-right">{percent(r.maxed, r.total)}%</b>
                </div>
              );
            })}
            {done.unlisted.length > 0 && (
              <p className="text-muted text-small">
                {done.unlisted.length === 1 ? '1 maxed card isn’t' : `${done.unlisted.length} maxed cards aren’t`} on MK Mobile Base's list under that rarity yet, so{' '}
                {done.unlisted.length === 1 ? 'it isn’t' : 'they aren’t'} counted: {done.unlisted.map((m) => m.name).join(', ')}.
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
        {listed.map((m) => (
          <div key={cardKey(m.rarityId, m.name)} className={`${row} items-center`}>
            <CardThumb card={{ id: '', name: m.name, rarityId: m.rarityId, fusion: 0, guest: false, imageUrl: imageOf(m) }} rule={ruleOf(m)} size={36} />
            <div className={grow}>
              <div className={rowTitle}>{m.name}</div>
              <div className="text-small">
                <RarityBadge rule={ruleOf(m)} />
                {m.at && <span className="text-muted">maxed {m.at}</span>}
              </div>
            </div>
            <button className={btn.ghost} onClick={() => remove(m)}>
              Remove
            </button>
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
  const onRecord = new Set((state.maxed ?? []).map((m) => cardKey(m.rarityId, m.name)));
  const inList = new Set(state.cards.map((c) => cardKey(c.rarityId, c.name)));
  const fresh = parsed.cards.filter((c) => !onRecord.has(cardKey(c.rarityId, c.name)));
  const already = parsed.cards.length - fresh.length;
  const stillListed = parsed.updates.length + parsed.duplicates.filter((d) => inList.has(d.key)).length;

  if (!open) {
    return (
      <div className={actions}>
        <button onClick={() => setOpen(true)}>Paste maxed cards…</button>
      </div>
    );
  }

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
    if (added) {
      setText('');
      setOpen(false);
    }
  }

  return (
    <div className="my-[0.6rem]">
      <p className="text-muted text-small md:max-w-[80ch]">
        One card per line, as in Paste a list: plain names go under the rarity picked here, a line that's just a rarity's name (like "Gold Kameo") switches it, or add a rarity after a name ("Kori Blade - Epic"). Levels are ignored.
      </p>
      <select value={rarityId} onChange={(e) => setPicked(e.target.value)} aria-label="Rarity for plain names">
        {state.rarities.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea className="w-full my-[0.4rem]" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Gold Kameo\nJade, Lizard\nKori Blade - Epic'} aria-label="Maxed cards" autoFocus />
      {already > 0 && <p className="text-muted text-small">{already === 1 ? '1 is' : `${already} are`} already on Maxed.</p>}
      {stillListed > 0 && <p className="text-muted text-small">Skipped {stillListed === 1 ? '1 card that’s' : `${stillListed} cards that are`} still in your card list, so not maxed yet.</p>}
      {parsed.problems.map((p) => (
        <p key={p.line} className="text-error text-small">
          Skipped "{p.line}": {p.reason}.
        </p>
      ))}
      <div className={actions}>
        <button
          onClick={() => {
            setText('');
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button className={btn.primary} onClick={add} disabled={fresh.length === 0}>
          Add {fresh.length}
        </button>
      </div>
    </div>
  );
}
