import { useEffect, useMemo, useState } from 'react';
import { noChange, useStore } from '../store';
import { usePlan } from '../planner';
import { loadCatalog, useCatalogVersion, type CatalogItem } from '../catalog';
import { buildTower, klashKey, pinFloors, type FloorPlan, type FloorRule, type KlashItem, type Tower } from '../klash';
import { seasonEnd } from '../engine';
import { nameKey } from '../names';
import { actions, card, check, grow, hint, row, rowTitle, subpanel } from '../classes';
import { Chip, ConfirmButton } from '../ui';
import type { KlashTower } from '../types';

const note = 'text-muted text-small';
const EMPTY: KlashTower = { enabled: false, pool: [], pins: {}, season: null };
const title = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The pool checklist's groups, in the game's order: characters, Kameos, then gear, best rarity first. */
const GROUPS: { label: string; kind: KlashItem['kind']; rarity: string }[] = [
  { label: 'Diamond characters', kind: 'character', rarity: 'diamond' },
  { label: 'Gold characters', kind: 'character', rarity: 'gold' },
  { label: 'Diamond Kameos', kind: 'kameo', rarity: 'diamond' },
  { label: 'Gold Kameos', kind: 'kameo', rarity: 'gold' },
  { label: 'Epic gear', kind: 'equipment', rarity: 'epic' },
  { label: 'Rare gear', kind: 'equipment', rarity: 'rare' },
];

/** What the tower needs from a card that the catalog may not have: stats, a class, or a gear slot. */
const noData = (c: KlashItem) => (c.kind === 'character' ? typeof c.attack !== 'number' : c.kind === 'kameo' ? !c.class?.length : !c.slot);

/** A floor's limits in words: "Gold F10 or Diamond F9 · Rare F10 and Epic F9 gear · Gold Kameo". */
function ruleText(rule: FloorRule) {
  const list = (r: Partial<Record<string, number>>, join: string) =>
    Object.entries(r)
      .map(([k, f]) => `${title(k)} F${f}`)
      .join(join);
  return `${list(rule.characters, ' or ')} · ${list(rule.gear, ' and ')} gear · ${title(rule.kameo)} Kameo`;
}

/**
 * The Klash Tower planner: tick this season's pool, and the 5 defensive floors fill themselves (src/klash.ts), with pins
 * to keep a card on a floor. Only shown while Settings → Klash Tower is on.
 */
export default function TowerView() {
  const { state, update } = useStore();
  const { now } = usePlan();
  const k = state.klashTower ?? EMPTY;
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped by Try again, and read again when a catalog fetched again has changed (as on Maxed).
  const [attempt, setAttempt] = useState(0);
  const catalogVersion = useCatalogVersion();
  const [q, setQ] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(
      (items) => !cancelled && (setCatalog(items), setFailed(false)),
      () => !cancelled && setFailed(true),
    );
    return () => void (cancelled = true);
  }, [attempt, catalogVersion]);

  // Keyed on what the pool and pins hold: every saved change (a sync pull, card art) gives them new arrays, and building
  // the tower takes tens of milliseconds on a phone.
  const poolKey = JSON.stringify(k.pool);
  const pinsKey = JSON.stringify(k.pins);
  const tower: Tower | null = useMemo(() => (catalog ? buildTower(catalog, JSON.parse(poolKey), JSON.parse(pinsKey)) : null), [catalog, poolKey, pinsKey]);
  // Pins per floor and kind ("3|character"), counted once: every pin select reads them on each render.
  const pinCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const [key, floor] of Object.entries(JSON.parse(pinsKey) as Record<string, number>)) n.set(`${floor}|${key.split(':')[0]}`, (n.get(`${floor}|${key.split(':')[0]}`) ?? 0) + 1);
    return n;
  }, [pinsKey]);
  const ticked = useMemo(() => new Set(k.pool), [k.pool]);

  // Each tap finds its card by key in the save as it is then, so a tap after a sync changed the pool does what it showed.
  const toggle = (item: KlashItem, on: boolean) =>
    update(
      (d) => {
        const cur = d.klashTower ?? { ...EMPTY };
        const key = klashKey(item);
        if (cur.pool.includes(key) === on) return noChange;
        const pool = on ? [...cur.pool, key] : cur.pool.filter((x) => x !== key);
        const pins = { ...cur.pins };
        if (!on) delete pins[key];
        // The pool belongs to the season it's being ticked in, so a new season can clear it (see clearOldKlashPool). Each
        // tick stamps the current season: cards added to last season's pool (one whose clear was undone, or ticked before
        // the schedule showed the new season) would otherwise be cleared with it later.
        d.klashTower = { ...cur, pool, pins, season: pool.length ? (seasonEnd(d.realmKlashSeasonEnd, now) ?? cur.season) : null };
      },
      on ? undefined : `Removed ${item.name} from the Klash pool`,
    );
  const pin = (item: KlashItem, floor: number | null) =>
    update(
      (d) => {
        const cur = d.klashTower;
        const key = klashKey(item);
        if (!cur || !cur.pool.includes(key) || (cur.pins[key] ?? null) === floor) return noChange;
        const pins = { ...cur.pins };
        if (floor === null) delete pins[key];
        else pins[key] = floor;
        d.klashTower = { ...cur, pins };
      },
      floor === null ? `Unpinned ${item.name}` : `Pinned ${item.name} to floor ${floor}`,
    );
  const clearPool = () =>
    update((d) => {
      if (!d.klashTower?.pool.length) return noChange;
      d.klashTower = { ...d.klashTower, pool: [], pins: {}, season: null };
    }, 'Cleared the Klash pool');
  const dropMissing = (keys: string[]) =>
    update((d) => {
      const cur = d.klashTower;
      if (!cur || !keys.some((x) => cur.pool.includes(x))) return noChange;
      const pins = Object.fromEntries(Object.entries(cur.pins).filter(([x]) => !keys.includes(x)));
      d.klashTower = { ...cur, pool: cur.pool.filter((x) => !keys.includes(x)), pins };
    }, 'Removed cards no longer in the card list');

  // A floor that already holds 3 pinned characters (or a pinned Kameo) takes no more pins.
  const pinCount = (floor: number, kind: KlashItem['kind']) => pinCounts.get(`${floor}|${kind}`) ?? 0;
  const pinSelect = (item: KlashItem) => {
    const mine = k.pins[klashKey(item)] ?? null;
    const full = (f: number) => f !== mine && pinCount(f, item.kind) >= (item.kind === 'kameo' ? 1 : 3);
    // The game won't put a character and the Kameo of its exact version on one floor, so a floor where the other one is
    // pinned isn't offered (the builder would set the pin aside).
    const twinFloor = k.pins[`${item.kind === 'kameo' ? 'character' : 'kameo'}:${nameKey(item.name)}`];
    const taken = (f: number) => f !== mine && twinFloor === f;
    return (
      <select className="w-auto" value={mine ?? ''} onChange={(e) => pin(item, e.target.value ? Number(e.target.value) : null)} aria-label={`Floor for ${item.name}`}>
        <option value="">{mine ? 'Unpin' : 'Pin to…'}</option>
        {pinFloors(item).map((f) => (
          <option key={f} value={f} disabled={full(f) || taken(f)}>
            {`Floor ${f}${full(f) ? ' (full)' : taken(f) ? (item.kind === 'kameo' ? ' (its fighter is there)' : ' (its Kameo is there)') : ''}`}
          </option>
        ))}
      </select>
    );
  };

  const floorCard = (plan: FloorPlan) => (
    <section key={plan.rule.floor} className={card} aria-label={`Floor ${plan.rule.floor}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="m-0">Floor {plan.rule.floor}</h3>
        <span className={note}>{ruleText(plan.rule)}</span>
      </div>
      {plan.short.length > 0 && <p className={`${hint} my-[0.5rem]`}>{title(plan.short.join('; '))}.</p>}
      {plan.fighters.map((f) => (
        <div key={f.item.name} className={`${row} items-center`}>
          <div className={grow}>
            <div className={rowTitle}>{f.item.name}</div>
            <div className="text-small">
              <Chip tone="muted">{`${title(f.item.rarity ?? '')} F${f.level}`}</Chip>
              {f.pinned && <Chip tone="limited">pinned</Chip>}
              {f.noData && <Chip tone="muted">no data</Chip>}
            </div>
            {f.gear.length > 0 && <div className={note}>{f.gear.map((g) => `${g.extra ? '+ ' : ''}${g.item.name}`).join(' · ')}</div>}
          </div>
          {pinSelect(f.item)}
        </div>
      ))}
      {plan.kameo && (
        <div className={`${row} items-center`}>
          <div className={grow}>
            <div className={rowTitle}>{plan.kameo.item.name}</div>
            <div className="text-small">
              <Chip tone="muted">{`${title(plan.kameo.item.rarity ?? '')} Kameo`}</Chip>
              {plan.kameo.pinned && <Chip tone="limited">pinned</Chip>}
              {noData(plan.kameo.item) && <Chip tone="muted">no data</Chip>}
            </div>
          </div>
          {pinSelect(plan.kameo.item)}
        </div>
      )}
      {plan.reasons.length > 0 && (
        <ul className={`${note} list-disc mt-[0.4rem] mb-0 pl-5`}>
          {plan.reasons.map((r) => (
            <li key={r.text}>{r.text}</li>
          ))}
        </ul>
      )}
    </section>
  );

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = catalog && (
    <section className={card} aria-label="Season pool">
      <h2 className="mt-0">Season pool ({k.pool.length})</h2>
      <p className={`${note} md:max-w-[75ch]`}>Tick every card this season deals you. Search matches words in any order.</p>
      <input className="w-full" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the pool" />
      {GROUPS.map((g) => {
        const items = catalog.filter((c) => c.kind === g.kind && c.rarity === g.rarity).sort((a, b) => a.name.localeCompare(b.name));
        const shown = items.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
        const count = items.filter((c) => ticked.has(klashKey(c))).length;
        if (!shown.length) return null;
        return (
          <details key={g.label} className={subpanel} open={words.length > 0}>
            <summary className="cursor-pointer font-semibold">{`${g.label} (${count} of ${items.length})`}</summary>
            <div className="md:grid md:grid-cols-2 md:gap-x-4">
              {shown.map((c) => (
                <label key={c.name} className={check}>
                  <input type="checkbox" checked={ticked.has(klashKey(c))} onChange={(e) => toggle(c, e.target.checked)} />
                  <span>{c.name}</span>
                  {noData(c) && <Chip tone="muted">no data</Chip>}
                </label>
              ))}
            </div>
          </details>
        );
      })}
      {k.pool.length > 0 && (
        <div className={actions}>
          <ConfirmButton label="Clear pool" onConfirm={clearPool} />
        </div>
      )}
    </section>
  );

  if (!catalog)
    return failed ? (
      <div className={hint} role="alert">
        <p className="my-[0.3rem]">Can't load card data. Check your connection.</p>
        <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    ) : (
      <p className={note}>Loading card data…</p>
    );

  return (
    <>
      <h2 className="mt-0">Klash Tower</h2>
      <p className={`${note} md:max-w-[75ch]`}>
        Your Realm Klash defence, built from this season's pool: the strongest team on floor 5, then down to floor 1, each with a Kameo and gear. Pin a card to keep it on a floor.
        {k.season && ` This pool is for the season ending ${new Date(k.season).toLocaleDateString()}; a new season clears it.`}
      </p>
      {!k.pool.length ? (
        pool
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-5 lg:items-start">
          <div>
            {tower!.missing.length > 0 && (
              <div className={`${hint} mb-[0.8rem]`}>
                <p className="my-[0.3rem]">
                  {tower!.missing.length === 1 ? '1 ticked card isn’t' : `${tower!.missing.length} ticked cards aren’t`} in MK Mobile Base's card list any more.
                </p>
                <button onClick={() => dropMissing(tower!.missing)}>Remove {tower!.missing.length === 1 ? 'it' : 'them'}</button>
              </div>
            )}
            {[...tower!.floors].reverse().map(floorCard)}
            {tower!.noSlot.length > 0 && <p className={note}>Not placed, as MK Mobile Base doesn't say which slot: {tower!.noSlot.map((c) => c.name).join(', ')}.</p>}
            {tower!.bench.length > 0 && <p className={note}>Left over: {tower!.bench.map((c) => c.name).join(', ')}.</p>}
          </div>
          {pool}
        </div>
      )}
      {failed && <p className={note}>Couldn't check for a newer card list; showing the last one.</p>}
    </>
  );
}
