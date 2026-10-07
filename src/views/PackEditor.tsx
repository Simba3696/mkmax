import { useState } from 'react';
import { newId, useStore } from '../store';
import { LevelOptions, Modal, NumInput, useNow } from '../ui';
import { actions, btn, check, field, form, modalFoot, subpanel } from '../classes';
import { REALM_KLASH_CURRENCY, addPool as withPool, editedPack, editorSeasonEnd, fromEndedSeason, isSeasonal, levelLabel, packEndOnSave, poolShare, savePack, seasonEnd, seasonMoveOnSave } from '../engine';
import { initialSource } from '../challenges';
import { scheduledSeasonEnd, useEvents } from '../events';
import type { Card, Pack, RarityRule } from '../types';

/** A line of inputs: a drop's card and chance, or the pool and new-card controls. */
const dropRow = 'flex gap-[0.4rem] items-center my-[0.35rem]';
const pctInput = 'w-[80px]';
const pickerItem = 'flex justify-between gap-[0.6rem] items-baseline py-[0.5rem] px-[0.7rem] cursor-pointer';

const cardLabel = (c: Card, rule: RarityRule | undefined) => `${c.name} ${c.fusion ? `(${levelLabel(rule, c.fusion)})` : '(new)'}`;

/**
 * Type-to-search card chooser. Every word typed has to appear in the name, in any order ("man sky" finds Man in
 * the Sky). Cards already in the pack are left out.
 */
function CardPicker({ value, exclude, onChange }: { value: string; exclude: Set<string>; onChange: (id: string) => void }) {
  const { state } = useStore();
  const [q, setQ] = useState<string | null>(null); // null = not searching: the input shows the chosen card
  const [hi, setHi] = useState(0);
  const rules = new Map(state.rarities.map((r) => [r.id, r]));
  const rarityOrder = (c: Card) => state.rarities.findIndex((r) => r.id === c.rarityId);
  const chosen = state.cards.find((c) => c.id === value);
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches =
    q == null
      ? []
      : state.cards
          .filter((c) => c.id !== value && !exclude.has(c.id) && words.every((w) => c.name.toLowerCase().includes(w)))
          .sort((a, b) => rarityOrder(a) - rarityOrder(b) || a.name.localeCompare(b.name))
          .slice(0, 40);

  function pick(c: Card) {
    onChange(c.id);
    setQ(null);
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        className="w-full"
        value={q ?? (chosen ? cardLabel(chosen, rules.get(chosen.rarityId)) : '')}
        placeholder="Search cards…"
        onFocus={(e) => {
          setQ('');
          setHi(0);
          // Keep the field in view above the keyboard.
          e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
        onBlur={() => setQ(null)}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && matches[hi]) {
            pick(matches[hi]);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.blur();
          } else return;
          e.preventDefault();
        }}
        aria-label="Card"
      />
      {q != null && (
        <ul
          className="absolute z-[2] inset-x-0 top-[calc(100%+2px)] m-0 py-[0.2rem] px-0 list-none max-h-[260px] md:max-h-[320px] overflow-y-auto overscroll-contain bg-panel-2 border border-line rounded-panel shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          role="listbox"
        >
          {matches.length === 0 && <li className={`${pickerItem} text-muted text-small`}>No cards match.</li>}
          {matches.map((c, i) => {
            const rule = rules.get(c.rarityId);
            return (
              // mousedown, not click: picking has to happen before the input's blur closes the list.
              <li
                key={c.id}
                role="option"
                aria-selected={i === hi}
                // Hover is a lighter fill on desktop, so the keyboard's active row still stands out.
                className={`${pickerItem} ${i === hi ? 'bg-line' : 'md:hover:bg-line/50'}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              >
                <span>{c.name}</span>
                <span className="text-small" style={{ color: rule?.color }}>
                  {rule?.label} · {c.fusion ? levelLabel(rule, c.fusion) : 'new'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function PackEditor({ initial, onClose }: { initial: Pack | null; onClose: () => void }) {
  const { state, update } = useStore();
  const [p, setP] = useState<Pack>(
    () =>
      initial ?? {
        id: newId(),
        name: '',
        currencyId: state.currencies[0]?.id ?? '',
        cost: 0,
        rolls: 1,
        maxPurchases: null,
        purchased: 0,
        startsAt: null,
        endsAt: null,
        drops: [],
      },
  );
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolRarity, setPoolRarity] = useState(state.rarities[0]?.id ?? '');
  const [poolPicked, setPoolPicked] = useState<Set<string>>(new Set());
  const [poolTotal, setPoolTotal] = useState<number | null>(null);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [newCard, setNewCard] = useState({ name: '', rarityId: state.rarities[0]?.id ?? '', fusion: 0 });
  const now = useNow();
  const events = useEvents();
  // While the schedule covers the season its date is used and can't be changed here, as in the season box.
  const scheduled = scheduledSeasonEnd(events, now);
  const currentSeasonEnd = scheduled ?? seasonEnd(state.realmKlashSeasonEnd, now);
  // What's typed in Season ends; undefined until the user changes it, so a season move synced in meanwhile shows
  // here and saving doesn't move the season back.
  const [seasonEdit, setSeasonEdit] = useState<string | null>();
  const seasonDraft = editorSeasonEnd(scheduled, seasonEdit, currentSeasonEnd);
  // The pack as it would be saved: Already bought and the end date as they are now, unless changed here.
  const [changed, setChanged] = useState<{ purchased?: boolean; endsAt?: boolean }>({});
  const base = editedPack(p, state.packs.find((x) => x.id === p.id), changed);
  // Blood Ruby characters, Kameos and Kameo packs leave with the season; unless the user said otherwise, guess from the item.
  const seasonal = isSeasonal(base, state);
  const pastSeason = fromEndedSeason(base, seasonDraft, now);
  const startSeasonEnd = base.startsAt ? scheduledSeasonEnd(events, new Date(base.startsAt)) : null;
  const endsAt = packEndOnSave(base, seasonal, seasonDraft, now, startSeasonEnd);
  // An item that starts after this season ends, e.g. next season's character entered ahead of time.
  const nextSeason = seasonal && !pastSeason && !!seasonDraft && endsAt !== seasonDraft;
  const showDate = (t: string) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const set = <K extends keyof Pack>(k: K, v: Pack[K]) => {
    setP((x) => ({ ...x, [k]: v }));
    if (k === 'purchased' || k === 'endsAt') setChanged((c) => ({ ...c, [k]: true }));
  };
  const setDrop = (i: number, patch: Partial<Pack['drops'][number]>) =>
    setP((x) => ({ ...x, drops: x.drops.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const totalChance = p.drops.reduce((a, d) => a + d.chance, 0);
  const inPack = new Set(p.drops.map((d) => d.cardId));
  const errors = [
    !p.name.trim() && 'Give the pack a name.',
    !(p.cost > 0) && 'Cost must be more than 0.',
    !(p.rolls >= 1) && 'Cards per purchase must be at least 1.',
    p.drops.some((d) => !d.cardId) && (p.store ? 'Choose the item being sold.' : 'Every drop row needs a card.'),
    p.startsAt && endsAt && p.startsAt >= endsAt && 'The end time must be after the start time.',
  ].filter(Boolean) as string[];

  function addNewCard() {
    if (!newCard.name.trim()) return;
    const card: Card = { id: newId(), name: newCard.name.trim(), rarityId: newCard.rarityId, fusion: newCard.fusion, guest: false };
    const source = initialSource(card, state.rarities);
    if (source) card.source = source;
    update((d) => void d.cards.push(card));
    setP((x) => ({ ...x, drops: x.store ? [{ cardId: card.id, chance: 100 }] : [...x.drops, { cardId: card.id, chance: 0 }] }));
    setNewCard((n) => ({ ...n, name: '', fusion: 0 }));
  }

  // The pool's total is shared by every item in it, not only the ones picked, so each card gets total ÷ pool size.
  const poolEach = poolShare(poolTotal, poolSize, poolPicked.size);
  // A card already listed (e.g. its own 1.5% line) can also be in the pool: the chances add up.
  const poolUpdates = p.drops.filter((d) => poolPicked.has(d.cardId));

  function addPool() {
    if (!poolEach) return;
    setP((x) => ({ ...x, drops: withPool(x.drops, poolPicked, poolEach) }));
    setPoolPicked(new Set());
    setPoolSize(null);
    setPoolOpen(false);
  }

  function save() {
    if (errors.length) return;
    // A corrected season end moves every pack that was ending with the old one, but only when it was changed here.
    const moveTo = seasonMoveOnSave({ seasonal, pastSeason, scheduled, edited: seasonEdit, currentEnd: currentSeasonEnd });
    const name = p.name.trim();
    update((d) => savePack(d, { ...base, endsAt }, moveTo, now), moveTo ? `Saved ${name} and changed the season end` : `Saved ${name}`);
    onClose();
  }

  return (
    <Modal title={initial && state.packs.some((x) => x.id === initial.id) ? 'Edit pack' : 'New pack'} onClose={onClose} wide>
      {/* The wide modal fits four columns: the name takes two and the store checkbox the other two rather than stretching a 900px input. */}
      <div className={`${form} lg:grid-cols-4`}>
        <label className={`${field} col-span-full lg:col-span-2`}>
          <span>Name</span>
          <input value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Klassic Diamond Pack" autoFocus />
        </label>
        <label className={`${check} col-span-full lg:col-span-2`}>
          <input
            type="checkbox"
            checked={!!p.store}
            onChange={(e) =>
              setP((x) =>
                e.target.checked
                  ? { ...x, store: true, rolls: 1, drops: [{ cardId: x.drops[0]?.cardId ?? '', chance: 100 }] }
                  : { ...x, store: false },
              )
            }
          />
          Store item: each purchase gives one guaranteed copy (e.g. the Realm Klash store)
        </label>
        <label className={field}>
          <span>Currency</span>
          <select value={p.currencyId} onChange={(e) => set('currencyId', e.target.value)}>
            {state.currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span>Cost</span>
          <NumInput value={p.cost} min={0} onChange={(v) => set('cost', v ?? 0)} />
        </label>
        {!p.store && (
          <label className={field}>
            <span>Cards per purchase</span>
            <NumInput value={p.rolls} min={1} step={1} onChange={(v) => set('rolls', v ?? 1)} />
          </label>
        )}
        <label className={field}>
          <span>Purchase limit</span>
          <NumInput value={p.maxPurchases} min={1} step={1} placeholder="unlimited" onChange={(v) => set('maxPurchases', v)} />
        </label>
        <label className={field}>
          <span>Already bought</span>
          <NumInput value={base.purchased} min={0} step={1} onChange={(v) => set('purchased', v ?? 0)} />
        </label>
        <label className={field}>
          <span>Starts (blank = now)</span>
          <input type="datetime-local" value={p.startsAt ?? ''} onChange={(e) => set('startsAt', e.target.value || null)} />
        </label>
        {p.currencyId === REALM_KLASH_CURRENCY && (
          <label className={`${check} col-span-full lg:col-span-2`}>
            <input type="checkbox" checked={seasonal} onChange={(e) => set('season', e.target.checked)} />
            Leaves when the Realm Klash season ends (characters, Kameos and Kameo packs rotate every 2 weeks; the gear stays)
          </label>
        )}
        {seasonal && !pastSeason && scheduled ? (
          <div className={field}>
            <span>Season ends</span>
            <b className="text-fg text-[0.95rem]">{showDate(scheduled)}</b>
          </div>
        ) : seasonal && !pastSeason ? (
          <label className={field}>
            <span>Season ends</span>
            <input type="datetime-local" value={seasonDraft ?? ''} onChange={(e) => setSeasonEdit(e.target.value || null)} />
          </label>
        ) : (
          <label className={field}>
            <span>Ends (blank = permanent)</span>
            <input type="datetime-local" value={base.endsAt ?? ''} onChange={(e) => set('endsAt', e.target.value || null)} />
          </label>
        )}
      </div>
      {seasonal && !pastSeason && (
        <p className="text-muted text-small lg:max-w-[75ch]">
          {scheduled
            ? "Shared by every seasonal Blood Ruby item. Date from MK Mobile Base's event schedule."
            : seasonDraft
              ? 'Shared by every seasonal Blood Ruby item. After it passes, the next season is assumed to end 2 weeks later.'
              : 'Enter when this season ends (from the in-game timer). You only need to do this once; later seasons follow every 2 weeks.'}
          {nextSeason && endsAt && ` This item starts after that, so it leaves when its own season ends: ${showDate(endsAt)}.`}
        </p>
      )}

      <h3>{p.store ? 'Item' : 'Drop chances'}</h3>
      {!p.store && (
        <p className="text-muted text-small lg:max-w-[75ch]">
          Enter the chance per card, per roll, from the pack's info screen. Only list cards you care about; the rest of the pool doesn't matter.
        </p>
      )}
      {/* Wide screens cap the drop rows near the phone/tablet width so the card search isn't stretched. */}
      <div className={p.store ? '' : 'lg:max-w-[640px]'}>
        {(p.store ? p.drops.slice(0, 1) : p.drops).map((d, i) => (
          <div key={i} className={dropRow}>
            <CardPicker value={d.cardId} exclude={inPack} onChange={(cardId) => setDrop(i, { cardId })} />
            {!p.store && (
              <>
                <NumInput className={pctInput} value={d.chance} min={0} max={100} onChange={(v) => setDrop(i, { chance: v ?? 0 })} />
                <span className="text-muted">%</span>
                <button className={btn.ghost} onClick={() => setP((x) => ({ ...x, drops: x.drops.filter((_, j) => j !== i) }))} aria-label="Remove drop">
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!p.store && (
        <>
          <div className={`text-small ${totalChance > 100 ? 'text-error' : 'text-muted'}`}>Total listed: {+totalChance.toFixed(3)}%</div>
          <div className={actions}>
            <button onClick={() => setP((x) => ({ ...x, drops: [...x.drops, { cardId: '', chance: 0 }] }))}>+ Drop</button>
            <button onClick={() => setPoolOpen(!poolOpen)}>+ Even pool…</button>
          </div>
        </>
      )}

      {poolOpen && !p.store && (
        <div className={subpanel}>
          <p className="text-muted text-small lg:max-w-[75ch]">
            For odds shown as "X% for one of these cards": pick the cards you want, enter X, and count every item in the pool, the ones you picked
            included. Each card gets X ÷ that count. A card that's already listed gets its share added to its chance.
          </p>
          <select value={poolRarity} onChange={(e) => setPoolRarity(e.target.value)}>
            {state.rarities.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-2 gap-y-0 my-[0.4rem] max-h-[220px] md:max-h-[300px] overflow-y-auto">
            {state.cards
              .filter((c) => c.rarityId === poolRarity)
              .map((c) => (
                <label key={c.id} className={check}>
                  <input
                    type="checkbox"
                    checked={poolPicked.has(c.id)}
                    onChange={(e) =>
                      setPoolPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                  />
                  {c.name}
                </label>
              ))}
          </div>
          <div className={`${dropRow} flex-wrap`}>
            <NumInput className={pctInput} value={poolTotal} min={0} max={100} placeholder="total" onChange={setPoolTotal} />
            <span className="text-muted">% for</span>
            <NumInput className={pctInput} value={poolSize} min={1} step={1} placeholder={String(poolPicked.size || 'items')} onChange={setPoolSize} />
            <span className="text-muted">items in the whole pool</span>
            <button className={btn.primary} disabled={!poolEach} onClick={addPool}>
              Add {poolPicked.size || ''} at {poolEach ? +poolEach.toFixed(3) : '–'}% each
            </button>
          </div>
          {poolSize != null && poolSize < poolPicked.size && <div className="text-small text-error">You picked more cards than the pool has; using {poolPicked.size}.</div>}
          {poolEach > 0 && poolUpdates.length > 0 && (
            <div className="text-small text-muted lg:max-w-[75ch]">
              Already listed, share added:{' '}
              {poolUpdates.map((d) => `${state.cards.find((c) => c.id === d.cardId)?.name} ${+d.chance.toFixed(3)}% → ${+(d.chance + poolEach).toFixed(3)}%`).join('; ')}
            </div>
          )}
        </div>
      )}

      <div className={subpanel}>
        <div className="text-small text-muted">Card not in your list yet? Add it here:</div>
        <div className={`${dropRow} flex-wrap`}>
          <input className="flex-1 lg:flex-[2]" value={newCard.name} placeholder="Card name" onChange={(e) => setNewCard({ ...newCard, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addNewCard()} />
          <select className="flex-1" value={newCard.rarityId} onChange={(e) => setNewCard({ ...newCard, rarityId: e.target.value })}>
            {state.rarities.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <select className="flex-1" value={newCard.fusion} onChange={(e) => setNewCard({ ...newCard, fusion: Number(e.target.value) })}>
            <LevelOptions rule={state.rarities.find((r) => r.id === newCard.rarityId)} />
          </select>
          <button onClick={addNewCard} disabled={!newCard.name.trim()}>
            Add card
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="list-disc pl-[40px] my-[1em] text-error text-small">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className={modalFoot}>
        <button onClick={onClose}>Cancel</button>
        <button className={btn.primary} onClick={save} disabled={errors.length > 0}>
          Save pack
        </button>
      </div>
    </Modal>
  );
}
