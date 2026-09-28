import { useEffect, useState, type ReactNode } from 'react';
import type { Card, RarityRule } from './types';
import { levelLabel } from './engine';

export function fmt(n: number) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: a < 10 ? 2 : 0 });
}

export const pct = (p: number) => `${+(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

export function timeUntil(iso: string, now: Date) {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Re-renders every minute so countdowns stay fresh. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Card art thumbnail; falls back to initials in the rarity color when there's no image or it fails to load. */
export function CardThumb({ card, rule, size = 44 }: { card: Card; rule?: RarityRule; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [card.imageUrl]);
  const style = { width: size, height: size, borderColor: rule?.color };
  if (card.imageUrl && !broken) {
    return <img className="thumb" style={style} src={card.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const initials = card.name
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span className="thumb thumb-empty" style={{ ...style, color: rule?.color }} aria-hidden>
      {initials}
    </span>
  );
}

export function RarityBadge({ rule }: { rule?: RarityRule }) {
  if (!rule) return <span className="badge">?</span>;
  return (
    <span className="badge" style={{ borderColor: rule.color, color: rule.color }}>
      {rule.label}
    </span>
  );
}

export function FusionLabel({ card, rule }: { card: Card; rule?: RarityRule }) {
  return card.fusion === 0 ? <span className="muted">Not owned</span> : <span>{levelLabel(rule, card.fusion)}</span>;
}

/** <option>s for "Not owned" (optional) plus every level of a rarity, labelled F…/A…. */
export function LevelOptions({ rule, from = 0, to }: { rule?: RarityRule; from?: number; to?: number }) {
  const max = to ?? (rule ? rule.dupesPerLevel.length + 1 : 10);
  return (
    <>
      {Array.from({ length: max - from + 1 }, (_, i) => from + i).map((l) => (
        <option key={l} value={l}>
          {levelLabel(rule, l)}
        </option>
      ))}
    </>
  );
}

/** Number input that allows a temporarily empty field while typing. */
export function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (text === '' ? value != null : Number(text) !== value) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      value={text}
      min={min}
      max={max}
      step={step ?? 'any'}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '') onChange(null);
        else if (!isNaN(Number(e.target.value))) onChange(Number(e.target.value));
      }}
    />
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Two-step delete button (no native confirm dialogs). */
export function ConfirmButton({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`${className ?? ''} ${armed ? 'danger' : ''}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Tap again to confirm' : label}
    </button>
  );
}
