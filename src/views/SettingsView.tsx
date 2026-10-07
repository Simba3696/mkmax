import { useRef, useState } from 'react';
import { newId, normalize, useStore } from '../store';
import { kardTable } from '../normalize';
import { DIAMOND_KARD_COSTS, defaultState, defaultWeights, sampleState } from '../defaults';
import { ConfirmButton, FoldCard, NumInput } from '../ui';
import { actions, btn, check, field, form, grow, subpanel } from '../classes';
import { copiesTotal, fLevel, levelLabel, maxFusion } from '../engine';
import SyncPanel from './SyncPanel';
import GearOrder from './GearOrder';
import type { RarityRule, Weights } from '../types';

const WEIGHT_HELP: { key: keyof Weights; label: string; help: string }[] = [
  { key: 'belowThreshold', label: 'Reaching the Kard threshold', help: 'Multiplier for copies that get a card to the level where Fusion Up Kards can be used.' },
  { key: 'unlock', label: 'Unlocking a new card', help: "Multiplier for the first copy of a card you don't own." },
  { key: 'guest', label: 'Guest / limited card', help: 'Multiplier for guest cards, since they only show up during limited events.' },
  { key: 'kameo', label: 'Kameos', help: 'Multiplier for Kameo copies. Kept low so your currency goes to gear and characters first, and to Kameos once those are done.' },
  { key: 'coveredByKards', label: 'Already covered by Kards', help: 'Multiplier for copies your Fusion Up Kards would cover anyway. Keep it low.' },
  { key: 'challenge', label: 'Challenge Kameo', help: 'Extra multiplier for Kameos you get for sure by finishing their Elder challenge, so Kameo packs are valued for the other Kameos.' },
  { key: 'closenessBonus', label: 'Close-to-max bonus', help: 'Extra value as a card nears max. 0.5 means +50% at max.' },
  { key: 'limitedBoost', label: 'Limited-time pack urgency', help: 'The planner prefers limited-time packs by this factor over permanent packs, which you can buy later.' },
];

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
  const { state, update, replace } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mkmax-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importData(file: File) {
    try {
      replace(normalize(JSON.parse(await file.text())));
      setMsg('Backup imported.');
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  /**
   * Kameos only need owning, so a Kameo rarity has no fusion steps or kards (normalize enforces the steps on load).
   * Applying that here removes the rarity's owned cards now, with Undo, rather than silently on the next load.
   */
  function setKind(ri: number, kind: RarityRule['kind']) {
    const r = state.rarities[ri];
    update(
      (d) => {
        const dr = d.rarities[ri];
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
            Your first copy of a card is F0. Each step below is the number of duplicates needed for the next level. One Fusion Up Kard counts as +1 fusion level.
          </p>
          {/*
            Two columns of rarities from lg, where each still gets room for a few form columns. CSS columns rather than a grid: the editors differ a lot in height (ascension levels), and columns
            stack them without the gaps a grid row leaves. Top margins are dropped since a column break swallows them,
            which left the two column tops out of line.
          */}
          <div className="lg:columns-2 lg:gap-3 lg:[&>div]:break-inside-avoid lg:[&>div]:mt-0 lg:[&>div]:mb-3">
            {state.rarities.map((r, ri) => {
              const kameo = r.kind === 'kameo';
              return (
                <div key={r.id} className={subpanel}>
                  <div className={form}>
                    <label className={field}>
                      <span>Name</span>
                      <input value={r.label} onChange={(e) => update((d) => void (d.rarities[ri].label = e.target.value))} />
                    </label>
                    {!kameo && (
                      <>
                        <label className={field}>
                          <span>Fusion Up Kards usable from</span>
                          <select
                            value={r.fusionUpThreshold ?? ''}
                            onChange={(e) =>
                              update((d) => {
                                const dr = d.rarities[ri];
                                dr.fusionUpThreshold = e.target.value ? Number(e.target.value) : null;
                                // Fill in missing costs now, as the next load would, so the plan doesn't change on a reload.
                                dr.kardsPerLevel = kardTable(dr);
                              })
                            }
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
                          <select value={r.goal} onChange={(e) => update((d) => void (d.rarities[ri].goal = e.target.value as 'max' | 'threshold'))}>
                            <option value="max">Max</option>
                            <option value="threshold" disabled={r.fusionUpThreshold == null}>
                              Kard threshold (F{r.fusionUpThreshold ?? '?'})
                            </option>
                          </select>
                        </label>
                        <label className={field}>
                          <span>Highest fusion (F…), rest are ascension</span>
                          <NumInput value={r.fusionMax} min={1} step={1} onChange={(v) => update((d) => void (d.rarities[ri].fusionMax = v ?? 10))} />
                        </label>
                      </>
                    )}
                    <label className={field}>
                      <span>Kind</span>
                      <select value={r.kind} onChange={(e) => setKind(ri, e.target.value as RarityRule['kind'])}>
                        <option value="character">Character</option>
                        <option value="equipment">Equipment</option>
                        <option value="kameo">Kameo (only need one copy)</option>
                      </select>
                    </label>
                    <label className={check}>
                      <input type="checkbox" checked={r.hasGuests} onChange={(e) => update((d) => void (d.rarities[ri].hasGuests = e.target.checked))} />
                      Has guest cards
                    </label>
                    <label className={field}>
                      <span>Color</span>
                      <input type="color" value={r.color} onChange={(e) => update((d) => void (d.rarities[ri].color = e.target.value))} />
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
                            <NumInput value={n} min={0} step={1} onChange={(v) => update((d) => void (d.rarities[ri].dupesPerLevel[li] = v ?? 0))} />
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
                        <button onClick={() => update((d) => void d.rarities[ri].dupesPerLevel.push(1))}>+ Level</button>
                        <button disabled={r.dupesPerLevel.length <= 1} onClick={() => update((d) => void d.rarities[ri].dupesPerLevel.pop())}>
                          − Level
                        </button>
                        <span className={`${note} lg:flex-1 lg:min-w-0`}>
                          Max {levelLabel(r, r.dupesPerLevel.length + 1)} · {copiesTotal(r)} copies total
                        </span>
                      </>
                    )}
                    <span className={`${grow} lg:hidden`} />
                    <button
                      className={btn.ghost}
                      disabled={state.cards.some((c) => c.rarityId === r.id)}
                      title={state.cards.some((c) => c.rarityId === r.id) ? 'Cards use this rarity' : 'Remove rarity'}
                      onClick={() => update((d) => void d.rarities.splice(ri, 1))}
                    >
                      Remove
                    </button>
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
                                update((d) => {
                                  const costs = d.rarities[ri].kardsPerLevel;
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
          {state.currencies.map((c, i) => {
            const used = state.packs.some((p) => p.currencyId === c.id);
            return (
              <div key={c.id} className="flex gap-[0.4rem] items-center my-[0.35rem]">
                <input className="flex-1 min-w-0" value={c.name} onChange={(e) => update((d) => void (d.currencies[i].name = e.target.value))} aria-label="Name" />
                <NumInput
                  className="flex-1"
                  value={c.perDay ?? null}
                  min={0}
                  placeholder="per day"
                  onChange={(v) => update((d) => void (v == null || v <= 0 ? delete d.currencies[i].perDay : (d.currencies[i].perDay = v)))}
                />
                <button className={btn.ghost} disabled={used} title={used ? 'Used by a pack' : 'Remove'} onClick={() => update((d) => void d.currencies.splice(i, 1))}>
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
        <button onClick={() => update((d) => void (d.weights = structuredClone(defaultWeights)))}>Reset weights</button>
      </FoldCard>

      <FoldCard id="settings-data" title="Data">
        <p className={`${note} md:max-w-[75ch]`}>Your data is saved in this browser only. Export a backup now and then, or use one to move to another device.</p>
        <div className={actions}>
          <button className={btn.primary} onClick={exportData}>
            Export backup
          </button>
          <button onClick={() => fileRef.current?.click()}>Import backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          <ConfirmButton label="Load sample data" onConfirm={() => (replace(sampleState()), setMsg('Sample data loaded.'))} />
          <ConfirmButton label="Erase everything" onConfirm={() => (replace(defaultState()), setMsg('All data erased.'))} />
        </div>
        {msg && <p className="text-small">{msg}</p>}
      </FoldCard>
      <p className={note}>Version {__APP_VERSION__}</p>
    </div>
  );
}
