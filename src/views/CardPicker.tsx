import { useState } from 'react';
import { useStore } from '../store';
import { levelLabel } from '../engine';
import type { Card, RarityRule } from '../types';

const pickerItem = 'flex justify-between gap-[0.6rem] items-baseline py-[0.5rem] px-[0.7rem] cursor-pointer';

const cardLabel = (c: Card, rule: RarityRule | undefined) => `${c.name} ${c.fusion ? `(${levelLabel(rule, c.fusion)})` : '(new)'}`;

/**
 * Type-to-search card chooser. Every word typed has to appear in the name, in any order ("man sky" finds Man in
 * the Sky). Cards in `exclude` are left out: ones already in the pack being edited, or ones a Kasket can't give.
 */
export default function CardPicker({ value, exclude, onChange }: { value: string; exclude: Set<string>; onChange: (id: string) => void }) {
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
