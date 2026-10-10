import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Card, RarityRule } from './types';
import { levelLabel, type KasketPool } from './engine';
import { btn, card, chipTone, type ChipTone } from './classes';

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
// Image URLs that failed to load this session, so "Find images" can retry those cards.
const brokenUrls = new Set<string>();
const brokenListeners = new Set<() => void>();
function markBroken(url: string) {
  if (brokenUrls.has(url)) return;
  brokenUrls.add(url);
  brokenListeners.forEach((l) => l());
}

/** Card image URLs that failed to load this session (re-renders when one more fails). */
export function useBrokenImageUrls(): ReadonlySet<string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    brokenListeners.add(l);
    return () => void brokenListeners.delete(l);
  }, []);
  return brokenUrls;
}

const thumb = 'flex-none max-w-none rounded-panel border-2 border-line object-cover bg-panel-2';

export function CardThumb({ card, rule, size = 44 }: { card: Card; rule?: RarityRule; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [card.imageUrl]);
  const style = { width: size, height: size, borderColor: rule?.color };
  if (card.imageUrl && !broken) {
    return <img className={thumb} style={style} src={card.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => (setBroken(true), markBroken(card.imageUrl!))} />;
  }
  const initials = card.name
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span className={`${thumb} inline-flex items-center justify-center font-extrabold text-[0.8rem]`} style={{ ...style, color: rule?.color }} aria-hidden>
      {initials}
    </span>
  );
}

const badge = 'inline-block border rounded-chip px-[5px] text-tiny font-semibold mr-[4px]';

export function RarityBadge({ rule }: { rule?: RarityRule }) {
  if (!rule) return <span className={badge}>?</span>;
  return (
    <span className={badge} style={{ borderColor: rule.color, color: rule.color }}>
      {rule.label}
    </span>
  );
}

export function FusionLabel({ card, rule }: { card: Card; rule?: RarityRule }) {
  return card.fusion === 0 ? <span className="text-muted">Not owned</span> : <span>{levelLabel(rule, card.fusion)}</span>;
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

/** `wide` gives forms with many columns (the pack editor) more room on desktop; phones are full width either way. */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Read while rendering: by the time an effect runs, a field inside has already taken focus with autoFocus.
  const [opener] = useState(() => document.activeElement);
  // Keep Tab and screen readers inside the pop-up (it sits outside #root), and on close put focus back where it was,
  // so the next Tab carries on from the pack you were on rather than the top of the page.
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.inert = true;
    return () => {
      if (root) root.inert = false;
      // Only once the pop-up is gone and focus fell to <body>; StrictMode's rehearsal cleanup leaves it in the form.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);
  // Rendered on <body>, outside the scrolling content, so the tab bar can't end up on top of it (iOS keeps
  // fixed elements inside a touch-scrolling container in that container's layer).
  return createPortal(
    // Tapping outside doesn't close it: a stray tap would throw away everything entered. Use ✕ or Cancel.
    <div
      data-modal
      className="fixed inset-0 z-10 flex justify-center items-start overflow-y-auto overscroll-contain bg-black/70 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      {/* my-auto centres it on tall screens and collapses to the top once it's taller than the screen. */}
      <div className={`w-full max-w-[640px] ${wide ? 'lg:max-w-[920px]' : ''} md:my-auto bg-panel border border-line rounded-modal p-4`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex justify-between items-center mb-[0.6rem]">
          <h2 className="m-0">{title}</h2>
          <button className={btn.ghost} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Two-step delete button (no native confirm dialogs). */
/** The date `days` from now, as "Oct 16", with the year when it isn't this year ("Feb 6, 2027"). */
export function daysFromNow(days: number, now: Date) {
  const d = new Date(now.getTime() + days * 86400000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

/**
 * A display choice remembered on this device (a list's sort order), not synced. Falls back to the first option
 * when nothing valid is saved or storage is blocked.
 */
export function useDeviceChoice<T extends string>(key: string, options: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && options.includes(saved) ? saved : options[0];
    } catch {
      return options[0];
    }
  });
  const choose = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // private mode: the choice just isn't remembered
    }
  };
  return [value, choose] as const;
}

/** Plan and Settings cards folded on this device; not synced, since it's only how the page is shown. */
const FOLDED_KEY = 'mkmax:folded';
const loadFolded = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** A card whose heading folds it away; it stays folded (on this device) until tapped again. */
export function FoldCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !loadFolded().includes(id));
  const toggle = () => {
    setOpen(!open);
    const rest = loadFolded().filter((x) => x !== id);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(open ? [...rest, id] : rest));
    } catch {
      // private mode: the fold just isn't remembered
    }
  };
  return (
    <section className={card}>
      <h2 className={open ? undefined : 'mb-0'}>
        <button className="group flex items-center gap-[0.45rem] w-full min-h-0 p-0 border-0 bg-transparent text-inherit text-left" aria-expanded={open} onClick={toggle}>
          <span className={`inline-block text-[0.8em] text-muted md:group-hover:text-fg transition-transform duration-150 motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} aria-hidden="true">
            ▾
          </span>
          {title}
        </button>
      </h2>
      {open && children}
    </section>
  );
}

export function ConfirmButton({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  // Ghost buttons (btn.ghost, alone or with extra classes after it) stay ghost when armed, as before; only the text changes.
  return (
    <button className={armed && !className?.startsWith(btn.ghost) ? btn.danger : className} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Tap again to confirm' : label}
    </button>
  );
}

/** A Kasket's pool in words: how many cards share the odds, or why it isn't valued. */
export function kasketLine(pool: KasketPool) {
  const rule = pool.rule;
  if (!rule) return "This Kasket's rarity no longer exists, so it isn't valued";
  const label = rule.label.replace(/ Equip$/, ''); // "Epic Equip" reads as "Epic gear"
  const [one, many] = {
    character: [`${label} character`, `${label} characters`],
    equipment: [`${label} gear piece`, `${label} gear`],
    kameo: [label, `${label}s`],
  }[rule.kind];
  const n = pool.cards.length;
  if (pool.mode === 'new') return n === 1 ? `New card: the only ${one} you don't own` : `New card: 1 in ${n} of the ${many} you don't own`;
  if (pool.mode === 'unmaxed') return n === 1 ? `You own them all: your only ${one} you haven't maxed` : `You own them all: 1 in ${n} of your ${many} you haven't maxed`;
  // "It gives": the newest cards, which it leaves out, may still be unowned.
  if (rule.goal !== 'max') return `You own every ${one} it gives, so this isn't valued`;
  return 'Nothing left in this Kasket that MK Max tracks';
}

/** Chip text for where a card comes from besides packs. */
export const SOURCE_LABELS: Record<NonNullable<Card['source']>, string> = { krypt: 'krypt', tower: 'tower', challenge: 'Elder challenge' };

/** A small rounded label: time left, guest, source, plan phase. With onClick it's a button that looks the same. */
export function Chip({ tone = 'plain', children, onClick, title }: { tone?: ChipTone; children: ReactNode; onClick?: () => void; title?: string }) {
  const look = `inline-block text-tiny py-[2px] px-[7px] rounded-full border whitespace-nowrap mr-[4px] ${chipTone[tone]}`;
  if (!onClick) return <span className={look} title={title}>{children}</span>;
  // min-h-0 undoes the base button's 38px minimum, so it sits in a line of chips at their height.
  return (
    <button className={`${look} min-h-0 md:hover:underline`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
