import { useState } from 'react';
import { newId, useStore } from '../store';
import { ConfirmButton } from '../ui';
import type { TowerEntry } from '../types';

const GRADES = ['Uncommon', 'Rare', 'Epic'];
/** Uncommon gear is green in the game; it isn't a tracked rarity, so its color lives here. */
const UNCOMMON_COLOR = '#5fd068';

/** Per-tower focus list: how many items each tower still has short of F3 (or max). */
export default function TowersPanel() {
  const { state, update } = useStore();
  const [draft, setDraft] = useState<Omit<TowerEntry, 'id'>>({ tower: '', grade: 'Epic', goal: 'F3', itemsLeft: 1 });

  const patch = (id: string, p: Partial<TowerEntry>) =>
    update((d) => {
      const t = d.towers.find((x) => x.id === id);
      if (t) Object.assign(t, p);
    });

  function add() {
    if (!draft.tower.trim()) return;
    update((d) => void d.towers.push({ id: newId(), ...draft, tower: draft.tower.trim() }));
    setDraft({ ...draft, tower: '' });
  }

  // Rare and Epic use their rarity colors (blue and purple), so the list matches the rest of the app.
  const gradeColor = (g: string) => (g === 'Uncommon' ? UNCOMMON_COLOR : state.rarities.find((r) => r.id === g.toLowerCase())?.color);
  const grades = [...new Set([...GRADES, ...state.towers.map((t) => t.grade)])];
  const total = state.towers.reduce((a, t) => a + (t.itemsLeft ?? 0), 0);

  return (
    <>
      <p className="muted small">
        Tower gear is farmed, not bought, so it isn't part of the plan. This is a focus list of which towers still have gear to finish. {total > 0 && `${total} items left in total.`}
      </p>
      {grades.map((g) => {
        const rows = state.towers.filter((t) => t.grade === g).sort((a, b) => (b.itemsLeft ?? 0) - (a.itemsLeft ?? 0) || a.tower.localeCompare(b.tower));
        if (!rows.length) return null;
        return (
          <section key={g} className="card">
            <h2 style={{ color: gradeColor(g) }}>{g}</h2>
            {rows.map((t) => (
              <div key={t.id} className="row">
                <div className="grow">
                  <div className={`row-title ${t.itemsLeft === 0 ? 'done-text' : ''}`}>{t.tower}</div>
                  <div className="muted small">
                    {t.itemsLeft === 0 ? 'Done' : t.itemsLeft == null ? 'Not counted' : `${t.itemsLeft} item${t.itemsLeft === 1 ? '' : 's'} to ${t.goal}`}
                  </div>
                </div>
                <div className="stepper">
                  <button onClick={() => patch(t.id, { itemsLeft: Math.max(0, (t.itemsLeft ?? 1) - 1) })} disabled={t.itemsLeft === 0} aria-label="One fewer">
                    −
                  </button>
                  <span className="stepper-val">{t.itemsLeft ?? '—'}</span>
                  <button onClick={() => patch(t.id, { itemsLeft: (t.itemsLeft ?? 0) + 1 })} aria-label="One more">
                    +
                  </button>
                </div>
                <ConfirmButton label="✕" className="ghost" onConfirm={() => update((d) => void (d.towers = d.towers.filter((x) => x.id !== t.id)))} />
              </div>
            ))}
          </section>
        );
      })}

      <section className="card">
        <h2>Add tower</h2>
        <div className="form">
          <label className="field wide">
            <span>Tower</span>
            <input value={draft.tower} placeholder="e.g. Kold Tower" onChange={(e) => setDraft({ ...draft, tower: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <label className="field">
            <span>Gear grade</span>
            <select value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value, goal: e.target.value === 'Uncommon' ? 'max' : 'F3' })}>
              {grades.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Goal</span>
            <select value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value as TowerEntry['goal'] })}>
              <option value="F3">F3</option>
              <option value="max">Max</option>
            </select>
          </label>
          <button className="primary" onClick={add} disabled={!draft.tower.trim()}>
            Add
          </button>
        </div>
      </section>
    </>
  );
}
