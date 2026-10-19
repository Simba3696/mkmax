import { useState } from 'react';
import { newId, noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { LevelOptions, Modal, NumInput, kasketLine, onMaxedNote } from '../ui';
import { actions, btn, check, field, form, modalFoot, subpanel } from '../classes';
import { REALM_KLASH_CURRENCY, addPool as withPool, editedPack, editorSeasonEnd, fromEndedSeason, entryGoal, isMaxed, isSeasonal, kasketPool, maxFusion, onMaxedRecord, packEndOnSave, poolShare, savePack, seasonEnd, seasonMoveOnSave } from '../engine';
import { initialSource } from '../challenges';
import { scheduledSeason, scheduledSeasonEnd, useEvents } from '../events';
import { kasketFor } from '../kaskets';
import type { Card, Pack, RarityRule } from '../types';
import CardPicker from './CardPicker';

/** A card as Add card here saves it: with the goal it's entered with (see `entryGoal`). */
const entered = (card: Card, rule: RarityRule): Card => {
  const goal = entryGoal(card, rule);
  return goal ? { ...card, goal } : card;
};

/** A line of inputs: a drop's card and chance, or the pool and new-card controls. */
const dropRow = 'flex gap-[0.4rem] items-center my-[0.35rem]';
const pctInput = 'w-[80px]';

export default function PackEditor({ initial, onClose }: { initial: Pack | null; onClose: () => void }) {
  const { state, update, newerSave } = useStore();
  // A store item left with no item (Delete on its card keeps it) opens with an empty item picker, so one is chosen
  // before it's saved.
  const [p, setP] = useState<Pack>(
    () =>
      (initial?.store && initial.drops.length === 0 ? { ...initial, drops: [{ cardId: '', chance: 100 }] } : initial) ?? {
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
  const { now, ctx } = usePlan();
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
  // A saved pack another device deleted while this was open (or a store item cleared once its card was done) isn't saved
  // back: Save says so and saves nothing, as any tap on something a sync has removed.
  const [wasSaved] = useState(() => !!initial && state.packs.some((x) => x.id === initial.id));
  const gone = wasSaved && !state.packs.some((x) => x.id === p.id);
  // A store item whose card a sync deletes while this is open would sell nothing, so it isn't saved either, until
  // another item is chosen. An item not chosen yet isn't one that was removed: the errors ask for it.
  const sold = p.drops.filter((x) => x.cardId);
  const itemGone = !!p.store && sold.length > 0 && sold.every((x) => !state.cards.some((c) => c.id === x.cardId));
  // Blood Ruby characters, Kameos and Kameo packs leave with the season; unless the user said otherwise, guess from the item.
  const seasonal = isSeasonal(base, state);
  const pastSeason = fromEndedSeason(base, seasonDraft, now);
  const startSeason = base.startsAt ? scheduledSeason(events, new Date(base.startsAt)) : null;
  const endsAt = packEndOnSave(base, seasonal, seasonDraft, now, startSeason);
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
  // Kaskets give characters or gear; a saved rarity that's since been removed isn't in the list, so it asks again.
  const kasketRarities = state.rarities.filter((r) => r.kind !== 'kameo');
  const kasketRule = kasketRarities.find((r) => r.id === p.kasket);
  const errors = [
    !p.name.trim() && 'Give the pack a name.',
    !(p.cost > 0) && 'Cost must be more than 0.',
    p.kasket === undefined && !(p.rolls >= 1) && 'Cards per purchase must be at least 1.',
    p.kasket !== undefined && !kasketRule && "Choose the Kasket's rarity.",
    // A drop whose card has since gone (deleted, or maxed and removed, on another device) shows no card, so it asks too.
    p.kasket === undefined &&
      p.drops.some((d) => !d.cardId || (!p.store && !state.cards.some((c) => c.id === d.cardId))) &&
      (p.store ? 'Choose the item being sold.' : 'Every drop row needs a card.'),
    p.startsAt && endsAt && p.startsAt >= endsAt && 'The end time must be after the start time.',
  ].filter(Boolean) as string[];

  // The rarity the box shows: the one picked, or the first once a sync has removed that one (its level starts at not owned).
  // A level a sync has since taken off the rarity shows, and is saved, as not owned too, so Add card isn't greyed out for it.
  const newCardRule = state.rarities.find((r) => r.id === newCard.rarityId) ?? state.rarities[0];
  const newCardFusion = newCardRule?.id === newCard.rarityId && newCard.fusion <= maxFusion(newCardRule) ? newCard.fusion : 0;
  // A level that is already the card's goal: the card would be done (and deleted) as soon as it's saved. Checked with
  // its name too, since Realm Klash gear is tracked to F10 whatever its rarity's Track until, and with the goal it's
  // saved with: one at or past its kard threshold goes on to its max.
  const newCardDone = !!newCardRule && isMaxed(entered({ id: '', name: newCard.name.trim(), rarityId: newCardRule.id, fusion: newCardFusion, guest: false }, newCardRule), newCardRule);
  // A card on the Maxed record (typing a pack's whole drop table, say) isn't one to start again.
  const newCardMaxed = !!newCard.name.trim() && !!newCardRule && onMaxedRecord(state, { name: newCard.name.trim(), rarityId: newCardRule.id });
  function addNewCard() {
    if (!newCard.name.trim() || !newCardRule) return;
    let card = undefined as Card | undefined;
    update((d) => {
      // Not under a rarity a sync removed after the editor was drawn: the card would be hidden everywhere, with no way
      // to delete it. A level a sync has since taken off the rarity is saved as not owned.
      const rule = d.rarities.find((r) => r.id === newCardRule.id);
      if (!rule) return noChange;
      const made = entered({ id: newId(), name: newCard.name.trim(), rarityId: rule.id, fusion: newCardFusion <= maxFusion(rule) ? newCardFusion : 0, guest: false }, rule);
      // A card already at its goal is done: the save would delete it at once and leave the pack a drop for nothing.
      // Nor one on the Maxed record.
      if (isMaxed(made, rule) || onMaxedRecord(d, made)) return noChange;
      const source = initialSource(made, d.rarities);
      if (source) made.source = source;
      d.cards.push(made);
      card = made;
    });
    // The typed name stays for another try when nothing was added.
    if (!card) return;
    const id = card.id;
    setP((x) => ({ ...x, drops: x.store ? [{ cardId: id, chance: 100 }] : [...x.drops, { cardId: id, chance: 0 }] }));
    setNewCard((n) => ({ ...n, rarityId: newCardRule.id, name: '', fusion: 0 }));
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
    let saved = false;
    update(
      (d) => ((wasSaved && !d.packs.some((x) => x.id === base.id)) || !(saved = savePack(d, { ...base, endsAt }, moveTo, now)) ? noChange : undefined),
      moveTo ? `Saved ${name} and changed the season end` : `Saved ${name}`,
    );
    // A tap that saved nothing (a sync removed the pack or its item just before it) leaves the editor open, so its note
    // shows and nothing typed is lost.
    if (saved) onClose();
  }

  return (
    <Modal title={wasSaved ? 'Edit pack' : 'New pack'} onClose={onClose} wide>
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
                  ? { ...x, store: true, kasket: undefined, rolls: 1, drops: [{ cardId: x.drops[0]?.cardId ?? '', chance: 100 }] }
                  : { ...x, store: false },
              )
            }
          />
          Store item: each purchase gives one guaranteed copy (e.g. the Realm Klash store)
        </label>
        <label className={`${check} col-span-full lg:col-span-2`}>
          <input
            type="checkbox"
            checked={p.kasket !== undefined}
            // The drop list and cards per purchase stay while editing, so unticking brings them back; saving a
            // Kasket drops them (savePack), as its odds are worked out from your cards.
            onChange={(e) => setP((x) => (e.target.checked ? { ...x, store: false, kasket: kasketFor(x.name) ?? '' } : { ...x, kasket: undefined }))}
          />
          Kasket: each purchase gives one random card you don't own from one rarity
        </label>
        {p.kasket !== undefined && (
          <label className={field}>
            <span>Kasket rarity</span>
            {/* A rarity that's since been removed shows "Choose…" rather than whichever option happens to be first. */}
            <select value={kasketRule ? p.kasket : ''} onChange={(e) => set('kasket', e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {kasketRarities.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {!p.store && p.kasket === undefined && (
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

      {p.kasket !== undefined ? (
        <>
          <h3>Pool</h3>
          <p className="text-muted text-small lg:max-w-[75ch]">
            {/* kasketLine has no full stop: the pack list shows it on its own. */}
            {kasketRule ? `${kasketLine(kasketPool(ctx, p))}.` : 'Choose the rarity this Kasket gives.'} Its odds follow your cards: unlocking one takes it out of the pool, and
            once you own every card it gives one you haven't maxed. The newest cards from the latest game update are left out.
          </p>
        </>
      ) : (
        <>
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
              <select className="flex-1" value={newCardRule?.id ?? ''} onChange={(e) => setNewCard({ ...newCard, rarityId: e.target.value })}>
                {state.rarities.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select className="flex-1" value={newCardFusion} onChange={(e) => setNewCard({ ...newCard, rarityId: newCardRule?.id ?? '', fusion: Number(e.target.value) })}>
                <LevelOptions rule={newCardRule} />
              </select>
              <button onClick={addNewCard} disabled={!newCard.name.trim() || newCardDone || newCardMaxed}>
                Add card
              </button>
            </div>
            {newCard.rarityId && newCardRule && newCardRule.id !== newCard.rarityId && (
              <div className="text-small text-muted">The rarity picked here has since been removed, so this card goes in as {newCardRule.label}.</div>
            )}
            {newCardDone && !newCardMaxed && <div className="text-small text-muted">That level is already the card's goal, so it would be done at once: pick a lower level to add it.</div>}
            {newCardMaxed && <div className="text-small text-muted lg:max-w-[75ch]">{onMaxedNote(newCardRule)}</div>}
          </div>
        </>
      )}

      {errors.length > 0 && (
        <ul className="list-disc pl-[40px] my-[1em] text-error text-small">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {gone && <p className="text-muted text-small">This pack has since been removed on another device, so saving it won't bring it back.</p>}
      {!gone && itemGone && <p className="text-muted text-small">The card this item sells has since been removed: choose another item to save it.</p>}
      {/* The notice saying why is behind this pop-up. */}
      {newerSave && <p className="text-muted text-small lg:max-w-[75ch]">Not saved: the data in this browser is from a newer version of MK Max, so changes aren’t saved until MK Max updates.</p>}
      <div className={modalFoot}>
        <button onClick={onClose}>Cancel</button>
        <button className={btn.primary} onClick={save} disabled={errors.length > 0 || gone || itemGone || newerSave}>
          Save pack
        </button>
      </div>
    </Modal>
  );
}
