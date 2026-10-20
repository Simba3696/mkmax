import { useEffect, useRef, useState } from 'react';
import { newId, noChange, normalize, useStore } from '../store';
import { savedText } from '../storage';
import { kardTable } from '../normalize';
import { DIAMOND_KARD_COSTS, defaultState, defaultWeights, sampleState } from '../defaults';
import { ConfirmButton, FoldCard, NumInput } from '../ui';
import { actions, btn, check, clearOfUndoBar, field, form, ghostBordered, glyphBtn, grow, hint, subpanel } from '../classes';
import { copiesTotal, fLevel, levelLabel, maxFusion, moveRarity, removeRarity } from '../engine';
import { fromNewerApp } from '../sync';
import { checkForAppUpdate } from '../appUpdate';
import SyncPanel from './SyncPanel';
import GearOrder from './GearOrder';
import type { AppState, RarityRule, Weights } from '../types';

const WEIGHT_HELP: { key: keyof Weights; label: string; help: string }[] = [
  { key: 'belowThreshold', label: 'Reaching the Kard threshold', help: 'Multiplier for copies that get a card to the level where Fusion Up Kards can be used, and for every copy of a card marked No kards, since packs are the only way to get those.' },
  { key: 'unlock', label: 'Unlocking a new card', help: "Multiplier for the first copy of a card you don't own." },
  { key: 'guest', label: 'Guest / limited card', help: 'Multiplier for guest cards, since they only show up during limited events.' },
  { key: 'kameo', label: 'Kameos', help: 'Multiplier for Kameo copies. Kept low so your currency goes to gear and characters first, and to Kameos once those are done.' },
  { key: 'coveredByKards', label: 'Already covered by Kards', help: 'Multiplier for copies your Fusion Up Kards would cover anyway. Keep it low.' },
  { key: 'challenge', label: 'Challenge Kameo', help: 'Extra multiplier for Kameos you get for sure by finishing their Elder challenge, so Kameo packs are valued for the other Kameos.' },
  { key: 'closenessBonus', label: 'Close-to-max bonus', help: 'Extra value as a card nears max. 0.5 means +50% at max.' },
  { key: 'limitedBoost', label: 'Limited-time pack urgency', help: 'The planner prefers limited-time packs by this factor over permanent packs, which you can buy later.' },
];

/** Removing a rarity also removes its Kaskets and its Maxed record entries (removeRarity), so the button and its Undo say so. */
function withRemoved(text: string, kaskets: number, maxed = 0) {
  const also = [kaskets && (kaskets === 1 ? 'its Kasket' : `its ${kaskets} Kaskets`), maxed && (maxed === 1 ? 'its maxed card' : `its ${maxed} maxed cards`)].filter(Boolean);
  return also.length === 2 ? `${text}, ${also[0]} and ${also[1]}` : also.length ? `${text} and ${also[0]}` : text;
}

const KIND_LABEL: Record<RarityRule['kind'], string> = { character: 'Character', equipment: 'Equipment', kameo: 'Kameo' };

/** Kard steps from the threshold to the rarity's top level (through ascension), as fusion-number indexes. */
const kardSteps = (r: RarityRule) => Array.from({ length: Math.max(0, r.dupesPerLevel.length - (r.fusionUpThreshold ?? 0)) }, (_, k) => (r.fusionUpThreshold ?? 0) + k);

/** Kards needed to take a card of this rarity from the threshold to its top level. */
const kardTotal = (r: RarityRule) => kardSteps(r).reduce((a, f) => a + (r.kardsPerLevel[f] || 0), 0);

const note = 'text-muted text-small';
const levelCaption = 'text-small text-muted mt-[0.8rem]';
const levels = 'grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-[0.4rem] mt-[0.6rem]';
const level = 'flex flex-col gap-[2px] [&_input]:w-full';

export default function SettingsView() {
  const { state, update, replace, unreadable, discardUnreadable, newerSave } = useStore();
  // replace() changes nothing while the save is from a newer version, so say that rather than that it worked.
  const replaced = (next: AppState, done: string) => {
    replace(next);
    setMsg(newerSave ? 'Nothing changed: the data saved in this browser is from a newer version of MK Max (see the notice at the top).' : done);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function download(text: string, name: string) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importData(file: File) {
    setMsg(null);
    try {
      const data = JSON.parse(await file.text());
      // This build would save it in its older format and sync that, and the newer build would rerun its one-time
      // upgrades over it. Looking for the update reloads into it if it's out.
      if (data && fromNewerApp(data)) {
        setMsg('This backup is from a newer version of MK Max. Pull down to refresh, or close MK Max and open it again, then import it.');
        void checkForAppUpdate();
        return;
      }
      replaced(normalize(data), 'Backup imported.');
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  // Rows are found by id when the change runs, not by their place on screen: a sync can reorder or remove rarities and
  // currencies while Settings is open, and a change by place would land on the wrong row. A row that's gone saves nothing.
  // A rule change that leaves cards done (− Level, a kind made Kameo) removes them without putting them on the Maxed
  // record: they weren't maxed in the game.
  const editRarity = (id: string, edit: (r: RarityRule) => void | typeof noChange, undoLabel?: string | (() => string)) =>
    update(
      (d) => {
        const r = d.rarities.find((x) => x.id === id);
        if (!r) return noChange;
        return edit(r);
      },
      undoLabel,
      { ruleChange: true },
    );
  // Past the neighbour shown on screen, so a tap after a sync moved either of the two moves nothing rather than the wrong one.
  const shiftRarity = (r: RarityRule, past: RarityRule, by: -1 | 1, keyboard: boolean) => {
    setMoved({ id: r.id, by, keyboard });
    update((d) => (moveRarity(d, r.id, past.id, by) ? undefined : noChange), `Moved ${r.label} ${by < 0 ? 'up' : 'down'}`);
  };
  // Each rarity's ↑ ↓ Remove group, by rarity id, and the last one moved.
  const arrowGroups = useRef(new Map<string, HTMLElement>());
  const [moved, setMoved] = useState<{ id: string; by: -1 | 1; keyboard: boolean } | null>(null);
  // A rarity panel is tall, so a move takes it a whole panel away from the finger that tapped: bring its arrows back into
  // view, so moving one several places is a few taps in a row. After a keyboard press (a click with detail 0, as Enter,
  // Space and assistive tech send), focus that was on the tapped arrow, or that the browser dropped to the page (some do
  // when a focused element's panel is moved), goes back to the tapped arrow, or to the other one when the move greyed it
  // out (the rarity reached an end). A tap leaves focus alone: Safari never focuses a tapped button, so focusing it then
  // would draw the focus ring after every tap. Focus somewhere else, like a field, stays put.
  useEffect(() => {
    if (!moved) return;
    setMoved(null);
    const group = arrowGroups.current.get(moved.id);
    if (!group) return;
    const up = group.querySelector<HTMLButtonElement>('[data-arrow=up]');
    const down = group.querySelector<HTMLButtonElement>('[data-arrow=down]');
    if (!up || !down) return;
    const [pressed, other] = moved.by < 0 ? [up, down] : [down, up];
    const target = pressed.disabled ? other : pressed;
    if (moved.keyboard && document.activeElement !== target && (document.activeElement === pressed || document.activeElement === document.body)) target.focus({ preventScroll: true });
    group.scrollIntoView({ block: 'nearest' });
  }, [moved, state.rarities]);
  const editCurrency = (id: string, edit: (c: AppState['currencies'][number]) => void) =>
    update((d) => {
      const c = d.currencies.find((x) => x.id === id);
      if (!c) return noChange;
      edit(c);
    });

  /**
   * Kameos only need owning, so a Kameo rarity has no fusion steps or kards (normalize enforces the steps on load).
   * Applying that here removes the rarity's owned cards now, with Undo, rather than silently on the next load.
   */
  function setKind(r: RarityRule, kind: RarityRule['kind']) {
    editRarity(
      r.id,
      (dr) => {
        if (dr.kind === kind) return noChange; // a sync already made it that kind
        dr.kind = kind;
        if (kind === 'kameo') Object.assign(dr, { dupesPerLevel: [], fusionMax: 0, goal: 'max', fusionUpThreshold: null, fusionUpKards: 0 });
        else if (dr.dupesPerLevel.length === 0) {
          // Built-in Kameo rarities have no fusion levels at all; start from the usual F10.
          if (dr.fusionMax < 1) dr.fusionMax = 10;
          dr.dupesPerLevel = Array(dr.fusionMax).fill(1);
        }
      },
      `Changed ${r.label} to ${KIND_LABEL[kind]}`,
    );
  }

  return (
    // From 2xl the rarity editors, the biggest section, get a column of their own on the right and the smaller sections
    // stack in a narrower column on the left, in DOM order (auto-placement skips the right column, which the Fusion
    // rules span). The last row is 1fr so it soaks up Fusion rules' extra height instead of spreading gaps between
    // the left-hand cards. The 6 in grid-rows is the number of left-column children (SyncPanel, Currencies, GearOrder,
    // Priority weights, Data, Version); change it when a section is added or removed.
    <div className="2xl:grid 2xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] 2xl:grid-rows-[repeat(6,auto)_1fr] 2xl:gap-x-5 2xl:items-start">
      <SyncPanel />

      <div className="2xl:col-start-2 2xl:row-[1/-1]">
        <FoldCard id="settings-fusion" title="Fusion rules">
          <p className={`${note} md:max-w-[75ch]`}>
            Your first copy of a card is F0. Each step below is the number of duplicates needed for the next level. Fusion Up Kards per step is how many kards each level costs from the kard threshold up.
          </p>
          {/*
            Two columns of rarities from lg, where each still gets room for a few form columns. CSS columns rather than a grid: the editors differ a lot in height (ascension levels), and columns
            stack them without the gaps a grid row leaves. Top margins are dropped since a column break swallows them,
            which left the two column tops out of line.
          */}
          <div className="lg:columns-2 lg:gap-3 lg:[&>div]:break-inside-avoid lg:[&>div]:mt-0 lg:[&>div]:mb-3">
            {state.rarities.map((r, i, all) => {
              const kameo = r.kind === 'kameo';
              return (
                <div key={r.id} className={subpanel}>
                  <div className={form}>
                    <label className={field}>
                      <span>Name</span>
                      <input value={r.label} onChange={(e) => editRarity(r.id, (x) => void (x.label = e.target.value))} />
                    </label>
                    {!kameo && (
                      <>
                        <label className={field}>
                          <span>Fusion Up Kards usable from</span>
                          <select
                            value={r.fusionUpThreshold ?? ''}
                            onChange={(e) => {
                              const threshold = e.target.value ? Number(e.target.value) : null;
                              // With no kards there's no threshold to stop at, so the planner tracks to max. Saying so in
                              // Track until, with Undo, rather than leaving it on a threshold that no longer applies. Both
                              // are decided from the rarity as it is now, which a sync may have changed.
                              let toMax = false;
                              editRarity(
                                r.id,
                                (dr) => {
                                  // Not on a rarity a sync has since made a Kameo: its kard settings are hidden, and would come
                                  // back switched on if it were made a character or gear again.
                                  if (dr.kind === 'kameo') return noChange;
                                  toMax = threshold == null && dr.goal === 'threshold';
                                  if (dr.fusionUpThreshold === threshold && !toMax) return noChange;
                                  dr.fusionUpThreshold = threshold;
                                  if (toMax) dr.goal = 'max';
                                  // Fill in missing costs now, as the next load would, so the plan doesn't change on a reload.
                                  dr.kardsPerLevel = kardTable(dr);
                                },
                                () => (toMax ? `${r.label} now tracks to max` : ''),
                              );
                            }}
                          >
                            <option value="">No kards for this rarity</option>
                            {Array.from({ length: r.fusionMax }, (_, i) => (
                              <option key={i} value={i + 1}>
                                F{i + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={field}>
                          <span>Track until</span>
                          <select
                            value={r.goal}
                            onChange={(e) => {
                              const goal = e.target.value as 'max' | 'threshold';
                              // Not a threshold a sync has since taken away (kards turned off), nor on a rarity now a Kameo:
                              // a goal with no threshold to stop at would drop its kards from the plan.
                              editRarity(r.id, (x) => (x.goal === goal || x.kind === 'kameo' || (goal === 'threshold' && x.fusionUpThreshold == null) ? noChange : void (x.goal = goal)));
                            }}
                          >
                            <option value="max">Max</option>
                            <option value="threshold" disabled={r.fusionUpThreshold == null}>
                              Kard threshold (F{r.fusionUpThreshold ?? '?'})
                            </option>
                          </select>
                        </label>
                        <label className={field}>
                          <span>Highest fusion (F…), rest are ascension</span>
                          <NumInput value={r.fusionMax} min={1} step={1} onChange={(v) => editRarity(r.id, (x) => (x.kind === 'kameo' ? noChange : void (x.fusionMax = v ?? 10)))} />
                        </label>
                      </>
                    )}
                    <label className={field}>
                      <span>Kind</span>
                      <select value={r.kind} onChange={(e) => setKind(r, e.target.value as RarityRule['kind'])}>
                        <option value="character">Character</option>
                        <option value="equipment">Equipment</option>
                        <option value="kameo">Kameo (only need one copy)</option>
                      </select>
                    </label>
                    <label className={check}>
                      <input type="checkbox" checked={r.hasGuests} onChange={(e) => editRarity(r.id, (x) => void (x.hasGuests = e.target.checked))} />
                      Has guest cards
                    </label>
                    <label className={field}>
                      <span>Color</span>
                      <input type="color" value={r.color} onChange={(e) => editRarity(r.id, (x) => void (x.color = e.target.value))} />
                    </label>
                  </div>
                  {/* Kameos have no fusion steps; a step added here would be wiped on the next load, deleting owned Kameos. */}
                  {!kameo && (
                    <>
                      <div className={levelCaption}>Duplicates per step</div>
                      <div className={levels}>
                        {r.dupesPerLevel.map((n, li) => (
                          <label key={li} className={level}>
                            <span className={note}>
                              {levelLabel(r, li + 1)}→{levelLabel(r, li + 2)}
                            </span>
                            <NumInput
                              value={n}
                              min={0}
                              step={1}
                              // Not past the end of a list a sync has shortened: that would leave holes, or bring a step back.
                              onChange={(v) => editRarity(r.id, (x) => (li < x.dupesPerLevel.length ? void (x.dupesPerLevel[li] = v ?? 0) : noChange))}
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <div className={actions}>
                    {kameo ? (
                      <span className={`${note} lg:flex-1 lg:min-w-0`}>Kameos only need one copy, so there are no fusion steps.</span>
                    ) : (
                      <>
                        <button
                          onClick={() =>
                            editRarity(r.id, (dr) => {
                              // Only to the steps on screen: not again if a sync already added one, nor to a rarity it made a Kameo.
                              if (dr.kind === 'kameo' || dr.dupesPerLevel.length !== r.dupesPerLevel.length) return noChange;
                              dr.dupesPerLevel.push(1);
                              // Give the new step its kard cost now, as the next load would, so the plan doesn't change on a reload.
                              dr.kardsPerLevel = kardTable(dr);
                            })
                          }
                        >
                          + Level
                        </button>
                        <button
                          disabled={r.dupesPerLevel.length <= 1}
                          onClick={() =>
                            // Only from the steps on screen, and never the last one: a sync that already took steps away
                            // could leave none, and every owned card of the rarity would count as maxed and be deleted.
                            editRarity(r.id, (x) => (x.dupesPerLevel.length > 1 && x.dupesPerLevel.length === r.dupesPerLevel.length ? void x.dupesPerLevel.pop() : noChange))
                          }
                        >
                          − Level
                        </button>
                        <span className={`${note} lg:flex-1 lg:min-w-0`}>
                          Max {levelLabel(r, r.dupesPerLevel.length + 1)} · {copiesTotal(r)} copies total
                        </span>
                      </>
                    )}
                    <span className={`${grow} lg:hidden`} />
                    {/* One group, right-aligned, so on a narrow phone the arrows and Remove wrap together instead of leaving
                        Remove alone at the left of a line of its own. */}
                    {/* clearOfUndoBar keeps the arrows above the Undo bar a move opens when a ↓ scrolls them to the bottom
                        edge; without it the next tap lands on Undo. */}
                    <span className={`flex gap-[0.4rem] ml-auto ${clearOfUndoBar}`} ref={(el) => void (el ? arrowGroups.current.set(r.id, el) : arrowGroups.current.delete(r.id))}>
                      <button className={glyphBtn} data-arrow="up" onClick={(e) => shiftRarity(r, all[i - 1], -1, e.detail === 0)} disabled={i === 0} aria-label={`Move ${r.label} up`} title="Move up">
                        ↑
                      </button>
                      <button className={glyphBtn} data-arrow="down" onClick={(e) => shiftRarity(r, all[i + 1], 1, e.detail === 0)} disabled={i === all.length - 1} aria-label={`Move ${r.label} down`} title="Move down">
                        ↓
                      </button>
                      {(() => {
                        const used = state.cards.some((c) => c.rarityId === r.id);
                        const maxedHere = (state.maxed ?? []).filter((m) => m.rarityId === r.id).length;
                        const remove = (confirmed: boolean) => {
                          // The Kaskets and Maxed entries counted as the change removes them: a sync may have added or
                          // removed some since.
                          let kaskets = 0;
                          let maxed = 0;
                          // Not if a sync already removed it, or brought in cards that use it. Nor on one tap if a sync
                          // has given it Maxed entries since the screen showed none: the button then asks for two taps.
                          update(
                            (d) => {
                              if (!d.rarities.some((x) => x.id === r.id) || d.cards.some((c) => c.rarityId === r.id)) return noChange;
                              if (!confirmed && d.maxed?.some((m) => m.rarityId === r.id)) return noChange;
                              kaskets = d.packs.filter((p) => p.kasket === r.id).length;
                              maxed = (d.maxed ?? []).filter((m) => m.rarityId === r.id).length;
                              removeRarity(d, r.id);
                            },
                            () => withRemoved(`Removed ${r.label}`, kaskets, maxed),
                          );
                        };
                        // Its Maxed history goes with it, and the tooltip doesn't show on phones: two taps, with the count on
                        // the button. Otherwise one tap, with Undo, as before.
                        const kaskets = state.packs.filter((p) => p.kasket === r.id).length;
                        if (!used && maxedHere > 0) return <ConfirmButton label={`Remove (${maxedHere} maxed)`} className={ghostBordered} onConfirm={() => remove(true)} title={withRemoved('Remove rarity', kaskets, maxedHere)} />;
                        return (
                          <button
                            className={ghostBordered}
                            disabled={used}
                            title={used ? 'Cards use this rarity' : withRemoved('Remove rarity', kaskets)}
                            onClick={() => remove(false)}
                          >
                            Remove
                          </button>
                        );
                      })()}
                    </span>
                  </div>
                  {!kameo && r.fusionUpThreshold != null && (
                    <>
                      <div className={levelCaption}>
                        Fusion Up Kards per step · {kardTotal(r)} kards from F{r.fusionUpThreshold} to {levelLabel(r, maxFusion(r))}
                      </div>
                      <div className={levels}>
                        {kardSteps(r).map((f) => (
                          <label key={f} className={level}>
                            <span className={note}>
                              {levelLabel(r, fLevel(f))}→{levelLabel(r, fLevel(f + 1))}
                            </span>
                            <NumInput
                              value={r.kardsPerLevel[f] ?? 0}
                              min={0}
                              step={1}
                              onChange={(v) =>
                                editRarity(r.id, (x) => {
                                  // Not for a step a sync has taken away: fewer levels, the rarity now a Kameo, or its kards turned off.
                                  if (x.fusionUpThreshold == null || !kardSteps(x).includes(f)) return noChange;
                                  const costs = x.kardsPerLevel;
                                  while (costs.length <= f) costs.push(0);
                                  costs[f] = v ?? 0;
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={() =>
              update(
                (d) =>
                  void d.rarities.push({ id: newId(), label: 'New rarity', kind: 'equipment', color: '#cccccc', dupesPerLevel: Array(10).fill(1), fusionMax: 10, goal: 'max', hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0, kardsPerLevel: [...DIAMOND_KARD_COSTS] }),
              )
            }
          >
            + Rarity
          </button>
        </FoldCard>
      </div>

      <FoldCard id="settings-currencies" title="Currencies">
        {/* Two per line on tablets and laptops so the name and per-day boxes don't stretch across the page. */}
        <div className="md:grid md:grid-cols-2 md:gap-x-6 2xl:block">
          {state.currencies.map((c) => {
            const used = state.packs.some((p) => p.currencyId === c.id);
            return (
              <div key={c.id} className="flex gap-[0.4rem] items-center my-[0.35rem]">
                <input className="flex-1 min-w-0" value={c.name} onChange={(e) => editCurrency(c.id, (x) => void (x.name = e.target.value))} aria-label="Name" />
                <NumInput
                  className="flex-1"
                  value={c.perDay ?? null}
                  min={0}
                  placeholder="per day"
                  onChange={(v) => editCurrency(c.id, (x) => void (v == null || v <= 0 ? delete x.perDay : (x.perDay = v)))}
                />
                <button className={btn.ghost} disabled={used} title={used ? 'Used by a pack' : 'Remove'} onClick={() =>
                    update((d) => {
                      // Not if a sync removed it, or a pack now uses it.
                      const i = d.currencies.findIndex((x) => x.id === c.id);
                      if (i < 0 || d.packs.some((p) => p.currencyId === c.id)) return noChange;
                      d.currencies.splice(i, 1);
                    }, `Removed ${c.name}`)
                  }>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <p className={`${note} md:max-w-[75ch]`}>
          The number is roughly how much you get each day. With it, the plan says when you can afford what it's saving for.
        </p>
        <button onClick={() => update((d) => void d.currencies.push({ id: newId(), name: 'New currency', balance: 0 }))}>+ Currency</button>
      </FoldCard>

      <GearOrder />

      <FoldCard id="settings-weights" title="Priority weights">
        <p className={`${note} md:max-w-[75ch]`}>Every card is being maxed. These only decide which copies the planner goes after first.</p>
        {/* Two columns while the section is page-wide, inputs lined up along each row's bottom. */}
        <div className="md:grid md:grid-cols-2 md:gap-x-6 md:items-end 2xl:block">
          {WEIGHT_HELP.map((w) => (
            <label key={w.key} className={`${field} my-[0.6rem] [&_input]:max-w-[120px]`}>
              <span>
                {w.label} <span className={note}>— {w.help}</span>
              </span>
              <NumInput value={state.weights[w.key]} min={0} onChange={(v) => update((d) => void (d.weights[w.key] = v ?? 0))} />
            </label>
          ))}
        </div>
        <button onClick={() => update((d) => void (d.weights = structuredClone(defaultWeights)), 'Reset weights')}>Reset weights</button>
      </FoldCard>

      <FoldCard id="settings-data" title="Data">
        {unreadable != null && (
          <div className={`${hint} mb-[0.6rem]`}>
            <p>
              The data saved in this browser couldn't be read, so MK Max started fresh. With sync on, the copy in your gist is downloaded instead. The
              unreadable data is kept here until you discard it, so download it first.
            </p>
            <div className={actions}>
              <button onClick={() => download(unreadable, 'mkmax-unreadable')}>Download unreadable data</button>
              <ConfirmButton label="Discard it" className={btn.ghost} onConfirm={discardUnreadable} />
            </div>
          </div>
        )}
        <p className={`${note} md:max-w-[75ch]`}>Your data is saved in this browser only. Export a backup now and then, or use one to move to another device.</p>
        <div className={actions}>
          <button className={btn.primary} onClick={() => download((newerSave && savedText()) || JSON.stringify(state, null, 2), 'mkmax-backup')}>
            Export backup
          </button>
          <button onClick={() => fileRef.current?.click()}>Import backup</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so picking the same file again (to roll back to it) still fires a change.
              e.target.value = '';
              if (file) void importData(file);
            }}
          />
          <ConfirmButton label="Load sample data" onConfirm={() => replaced(sampleState(), 'Sample data loaded.')} />
          <ConfirmButton label="Erase everything" onConfirm={() => replaced(defaultState(), 'All data erased.')} />
        </div>
        {msg && <p className="text-small">{msg}</p>}
      </FoldCard>
      <p className={note}>Version {__APP_VERSION__}</p>
    </div>
  );
}
