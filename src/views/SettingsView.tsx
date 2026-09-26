import { useRef, useState } from 'react';
import { newId, normalize, useStore } from '../store';
import { defaultState, defaultWeights, sampleState } from '../defaults';
import { ConfirmButton, NumInput, TIER_LABEL } from '../ui';
import { copiesTotal, levelLabel } from '../engine';
import type { Tier, Weights } from '../types';

const WEIGHT_HELP: { key: Exclude<keyof Weights, 'tier'>; label: string; help: string }[] = [
  { key: 'belowThreshold', label: 'Reaching the Kard threshold', help: 'Multiplier for copies that get a card to the level where Fusion Up Kards can be used.' },
  { key: 'unlock', label: 'Unlocking a new card', help: "Multiplier for the first copy of a card you don't own." },
  { key: 'guest', label: 'Guest / limited card', help: 'Multiplier for guest cards, since they only show up during limited events.' },
  { key: 'coveredByKards', label: 'Already covered by Kards', help: 'Multiplier for copies your Fusion Up Kards would cover anyway. Keep it low.' },
  { key: 'closenessBonus', label: 'Close-to-max bonus', help: 'Extra value as a card nears max. 0.5 means +50% at max.' },
  { key: 'limitedBoost', label: 'Limited-time pack urgency', help: 'The planner prefers limited-time packs by this factor over permanent packs, which you can buy later.' },
];

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

  return (
    <>
      <section className="card">
        <h2>Fusion rules</h2>
        <p className="muted small">
          Your first copy of a card is F0. Each step below is the number of duplicates needed for the next level. One Fusion Up Kard counts as +1 fusion level.
        </p>
        {state.rarities.map((r, ri) => (
          <div key={r.id} className="subpanel">
            <div className="form">
              <label className="field">
                <span>Name</span>
                <input value={r.label} onChange={(e) => update((d) => void (d.rarities[ri].label = e.target.value))} />
              </label>
              <label className="field">
                <span>Fusion Up Kards usable from</span>
                <select
                  value={r.fusionUpThreshold ?? ''}
                  onChange={(e) => update((d) => void (d.rarities[ri].fusionUpThreshold = e.target.value ? Number(e.target.value) : null))}
                >
                  <option value="">No kards for this rarity</option>
                  {Array.from({ length: r.fusionMax }, (_, i) => (
                    <option key={i} value={i + 1}>
                      F{i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Track until</span>
                <select value={r.goal} onChange={(e) => update((d) => void (d.rarities[ri].goal = e.target.value as 'max' | 'threshold'))}>
                  <option value="max">Max</option>
                  <option value="threshold" disabled={r.fusionUpThreshold == null}>
                    Kard threshold (F{r.fusionUpThreshold ?? '?'})
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Highest fusion (F…), rest are ascension</span>
                <NumInput value={r.fusionMax} min={1} step={1} onChange={(v) => update((d) => void (d.rarities[ri].fusionMax = v ?? 10))} />
              </label>
              <label className="field">
                <span>Kind</span>
                <select value={r.kind} onChange={(e) => update((d) => void (d.rarities[ri].kind = e.target.value as 'character' | 'equipment'))}>
                  <option value="character">Character</option>
                  <option value="equipment">Equipment</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={r.hasGuests} onChange={(e) => update((d) => void (d.rarities[ri].hasGuests = e.target.checked))} />
                Has guest cards
              </label>
              <label className="field">
                <span>Color</span>
                <input type="color" value={r.color} onChange={(e) => update((d) => void (d.rarities[ri].color = e.target.value))} />
              </label>
            </div>
            <div className="levels">
              {r.dupesPerLevel.map((n, li) => (
                <label key={li} className="level">
                  <span className="small muted">
                    {levelLabel(r, li + 1)}→{levelLabel(r, li + 2)}
                  </span>
                  <NumInput value={n} min={0} step={1} onChange={(v) => update((d) => void (d.rarities[ri].dupesPerLevel[li] = v ?? 0))} />
                </label>
              ))}
            </div>
            <div className="actions">
              <button onClick={() => update((d) => void d.rarities[ri].dupesPerLevel.push(1))}>+ Level</button>
              <button disabled={r.dupesPerLevel.length <= 1} onClick={() => update((d) => void d.rarities[ri].dupesPerLevel.pop())}>
                − Level
              </button>
              <span className="muted small">
                Max {levelLabel(r, r.dupesPerLevel.length + 1)} · {copiesTotal(r)} copies total
              </span>
              <span className="grow" />
              <button
                className="ghost"
                disabled={state.cards.some((c) => c.rarityId === r.id)}
                title={state.cards.some((c) => c.rarityId === r.id) ? 'Cards use this rarity' : 'Remove rarity'}
                onClick={() => update((d) => void d.rarities.splice(ri, 1))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            update(
              (d) =>
                void d.rarities.push({ id: newId(), label: 'New rarity', kind: 'equipment', color: '#cccccc', dupesPerLevel: Array(10).fill(1), fusionMax: 10, goal: 'max', hasGuests: false, fusionUpThreshold: null, fusionUpKards: 0 }),
            )
          }
        >
          + Rarity
        </button>
      </section>

      <section className="card">
        <h2>Currencies</h2>
        {state.currencies.map((c, i) => {
          const used = state.packs.some((p) => p.currencyId === c.id);
          return (
            <div key={c.id} className="drop-row">
              <input className="grow" value={c.name} onChange={(e) => update((d) => void (d.currencies[i].name = e.target.value))} />
              <button className="ghost" disabled={used} title={used ? 'Used by a pack' : 'Remove'} onClick={() => update((d) => void d.currencies.splice(i, 1))}>
                ✕
              </button>
            </div>
          );
        })}
        <button onClick={() => update((d) => void d.currencies.push({ id: newId(), name: 'New currency', balance: 0 }))}>+ Currency</button>
      </section>

      <section className="card">
        <h2>Priority weights</h2>
        <div className="form">
          {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
            <label key={t} className="field">
              <span>{TIER_LABEL[t]} weight</span>
              <NumInput value={state.weights.tier[t]} min={0} onChange={(v) => update((d) => void (d.weights.tier[t] = v ?? 0))} />
            </label>
          ))}
        </div>
        {WEIGHT_HELP.map((w) => (
          <label key={w.key} className="field weight">
            <span>
              {w.label} <span className="muted small">— {w.help}</span>
            </span>
            <NumInput value={state.weights[w.key]} min={0} onChange={(v) => update((d) => void (d.weights[w.key] = v ?? 0))} />
          </label>
        ))}
        <button onClick={() => update((d) => void (d.weights = structuredClone(defaultWeights)))}>Reset weights</button>
      </section>

      <section className="card">
        <h2>Data</h2>
        <p className="muted small">Your data is saved in this browser only. Export a backup now and then, or use one to move to another device.</p>
        <div className="actions">
          <button className="primary" onClick={exportData}>
            Export backup
          </button>
          <button onClick={() => fileRef.current?.click()}>Import backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          <ConfirmButton label="Load sample data" onConfirm={() => (replace(sampleState()), setMsg('Sample data loaded.'))} />
          <ConfirmButton label="Erase everything" onConfirm={() => (replace(defaultState()), setMsg('All data erased.'))} />
        </div>
        {msg && <p className="small">{msg}</p>}
      </section>
    </>
  );
}
