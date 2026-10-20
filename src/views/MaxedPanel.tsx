import { useEffect, useMemo, useRef, useState } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { maxedKeys, recordMaxed } from '../engine';
import { completion, findInCatalog, loadCatalog, type CatalogItem } from '../catalog';
import { cardKey, parseCardList } from '../cardList';
import { CardThumb, ConfirmButton, RarityBadge, dayLabel } from '../ui';
import { actions, barFill, btn, card, field, glyphBtn, grow, row, rowDivider, rowTitle, subpanel } from '../classes';
import type { MaxedCard } from '../types';

/** Whole percent, rounded down so a rarity reads 100% only once every card is maxed. */
const percent = (n: number, of: number) => (of ? Math.floor((n / of) * 100) : 0);

/** Whether the browser takes `value` as a background color: it drops anything else when the style is set. */
function isColor(value: string) {
  // The style parser also takes keywords and var(), which would leave the bar see-through or track-colored rather than
  // falling back to red to gold.
  if (/^\s*(transparent|inherit|initial|unset|revert|revert-layer|currentcolor)\s*$/i.test(value) || /var\(/i.test(value)) return false;
  const style = document.createElement('div').style;
  style.backgroundColor = value;
  return style.backgroundColor !== '';
}

/**
 * A completion bar in the rarity's color, or the Plan bars' red to gold overall. It fills to the exact share, not the
 * rounded-down figure beside it: most rarities sit at a few percent, which would round to an empty bar. The exact share
 * still only fills the bar once every card is maxed, and any maxed card shows at least a dot.
 */
function Bar({ n, of, color, label }: { n: number; of: number; color?: string; label: string }) {
  // A rarity's color comes from synced or imported data: one the browser doesn't accept as a color would leave the fill
  // invisible, so the bar falls back to the red to gold fill instead.
  const fill = color && isColor(color) ? color : undefined;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent(n, of)} aria-valuemin={0} aria-valuemax={100} className="h-[8px] mt-[0.35rem] bg-line rounded-chip overflow-hidden">
      {/* backgroundColor, not background: a rarity's color comes from synced data, and only a plain color belongs here. */}
      <div className={`h-full rounded-chip ${n > 0 ? 'min-w-[8px]' : ''} ${fill ? '' : barFill}`} style={{ width: `${of ? (n / of) * 100 : 0}%`, backgroundColor: fill }} />
    </div>
  );
}

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
            {/* No bottom margin: the bar under it belongs to this figure, so it sits as close as the rarity bars do. */}
            <p className="mb-0">
              <b>{percent(counted, total)}%</b> of every card MK Mobile Base lists: {counted} of {total} maxed.
            </p>
            <Bar n={counted} of={total} label="Overall completion" />
            <div className="mt-[0.6rem]">
              {done.rarities.map((r) => {
                const rule = rarities.find((x) => x.id === r.rarityId);
                return (
                  <div key={r.rarityId} className={rowDivider}>
                    <div className="flex gap-[0.6rem] items-center">
                      <div className={grow}>
                        <RarityBadge rule={rule} />
                      </div>
                      <span className="text-muted text-small">
                        {r.maxed} of {r.total}
                      </span>
                      <b className="min-w-[3.5rem] text-right">{percent(r.maxed, r.total)}%</b>
                    </div>
                    <Bar n={r.maxed} of={r.total} color={rule?.color} label={`${rule?.label ?? 'Rarity'} maxed`} />
                  </div>
                );
              })}
            </div>
            {done.unlisted.length > 0 && (
              <p className="text-muted text-small md:max-w-[80ch]">
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
          A card goes here when it reaches its top level (F10, or a Gold card's own cap) or, for a Kameo, when you own it. A card the app stops tracking at F3 (gear, by default) isn't maxed yet, so add it here once you've finished it in the game.
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
            <ConfirmButton label="✕" className={glyphBtn} onConfirm={() => remove(m)} title={`Remove ${m.name} from Maxed`} ariaLabel={`Remove ${m.name} from Maxed`} />
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
  // Read only while the box is open: every change elsewhere in the app gives the list a new state.cards.
  const parsed = useMemo(() => (open ? parseCardList(text, state.rarities, rarityId, state.cards) : null), [open, text, state.rarities, rarityId, state.cards]);

  if (!parsed) {
    return (
      <div className={actions}>
        <button onClick={() => setOpen(true)}>Paste maxed cards…</button>
      </div>
    );
  }

  // Only while the box is open: the page redraws on every change, hidden or not.
  const onRecord = maxedKeys(state);
  const inList = new Set(state.cards.map((c) => cardKey(c.rarityId, c.name)));
  // With every rarity removed, plain names have no rarity to go under, so they can't be added until there's one.
  const live = (c: { rarityId: string }) => state.rarities.some((r) => r.id === c.rarityId);
  const noRarity = parsed.cards.filter((c) => !live(c));
  const fresh = parsed.cards.filter((c) => live(c) && !onRecord.has(cardKey(c.rarityId, c.name)));
  const already = parsed.cards.filter((c) => live(c) && onRecord.has(cardKey(c.rarityId, c.name)));
  const stillListed = [...parsed.updates, ...parsed.duplicates.filter((d) => inList.has(d.key))];

  const add = () => {
    let added = 0;
    let recorded: { key: string; row: number }[] = [];
    update(
      (d) => {
        // As the screen showed, checked against the save as it is now: not under a rarity a sync removed, nor a card a
        // sync has put back in the list.
        const have = new Set(d.cards.map((c) => cardKey(c.rarityId, c.name)));
        const ok = fresh.filter((c) => d.rarities.some((r) => r.id === c.rarityId) && !have.has(cardKey(c.rarityId, c.name)));
        const before = d.maxed?.length ?? 0;
        recordMaxed(d, ok.map((c) => ({ name: c.name, rarityId: c.rarityId })));
        added = (d.maxed?.length ?? 0) - before;
        if (!added) return noChange;
        recorded = ok.map((c) => ({ key: cardKey(c.rarityId, c.name), row: c.row }));
      },
      () => `Added ${added} to Maxed`,
    );
    if (!added) return;
    // Lines now on the record, and ones for cards already on it or still in the list (a line pasted twice too), have
    // nothing to fix, so they go; everything else stays as typed (headings, lines skipped with a reason, ones a sync made
    // unusable just before the tap), so they can be fixed and added. Found by their place in the text, not their
    // wording: the same line under another heading is another card. With nothing left to fix, the box closes.
    const recordedKeys = new Set(recorded.map((r) => r.key));
    const twice = parsed.duplicates.filter((d) => onRecord.has(d.key) || recordedKeys.has(d.key));
    const done = new Set([...recorded, ...already, ...stillListed, ...twice].map((x) => x.row));
    const left = fresh.length - recorded.length + parsed.problems.length;
    if (!left) {
      setText('');
      setOpen(false);
    } else setText(text.split(/\r?\n/).filter((_, row) => !done.has(row)).join('\n'));
  };

  // As Paste a list words it: what's new, then what's skipped.
  const status = [
    fresh.length ? `New: ${fresh.length}` : 'Nothing to add yet.',
    already.length > 0 && `skipping ${already.length} already on Maxed (${already.map((c) => c.name).join('; ')})`,
    noRarity.length > 0 && `skipping ${noRarity.length} with no rarity to go under: add one in Settings first`,
    stillListed.length > 0 && `skipping ${stillListed.length} still in your card list, so not maxed yet (${stillListed.map((x) => x.name).join('; ')})`,
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
      <textarea className="mt-[0.6rem]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Gold Kameo\nJade, Lizard\nKori Blade - Epic'} aria-label="Maxed cards" autoFocus />
      <div className="text-small text-muted md:max-w-[80ch]">{status.join(' · ')}</div>
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
