import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Card, RarityRule } from './types';
import { levelLabel, targetLevel, type KardPlan, type KasketPool } from './engine';
import { btn, card, chipTone, type ChipTone } from './classes';

export function fmt(n: number) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: a < 10 ? 2 : 0 });
}

// Only a sure drop reads 100% and only an impossible one 0%: a chance just under certain shows as 99%, and a tiny
// but real one as <0.1%.
const pct = (p: number) => {
  const v = +(p * 100).toFixed(p < 0.1 ? 1 : 0);
  if (p > 0 && v === 0) return '<0.1%';
  return `${p < 1 && v >= 100 ? 99 : v}%`;
};

export function timeUntil(iso: string, now: Date) {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** How often the app reads the time while it's open, so countdowns stay fresh: once a minute. */
const TICK_MS = 60000;
/** Back after this long in the background, the app reads the time again: half a minute. */
const AWAY_MS = 30000;

/**
 * The time, read again every minute so countdowns stay fresh, and when the app comes back after half a minute or more
 * in the background or is restored from the back-forward cache. A reading on return starts the minute over.
 * PlanProvider holds the one clock the views share, as `usePlan().now`.
 */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let readAt = Date.now();
    const read = () => {
      readAt = Date.now();
      setNow(new Date(readAt));
    };
    let t = setInterval(read, TICK_MS);
    // A phone can hold the app in the background for hours with timers paused; read the time again on return so
    // packs that ended meanwhile don't still count as on sale. How long the app was away decides, so a quick app
    // switch keeps the time it had and doesn't run the whole planner again; the minute timer covers the rest.
    // Started in the background (a tab opened behind another): time the absence from load.
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const onReturn = () => {
      // Back after a while: read the time unless the minute timer already caught up, so the plan isn't worked out
      // twice. Back from a quick switch, or with no hidden event seen (some browsers skip it on a back-forward restore,
      // and one that sends two events has cleared it): read it only if a minute tick was missed, since a phone can
      // pause timers while it sleeps and short screen locks would otherwise leave the time behind.
      const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS;
      hiddenAt = null;
      const age = Date.now() - readAt;
      // A reading from later than now means the device clock went back: read it again.
      if (age >= 0 && age < (away ? AWAY_MS : TICK_MS)) return;
      read();
      // Start the minute over, or the tick the phone held back while asleep fires moments later and runs the planner
      // again for the same minute.
      clearInterval(t);
      t = setInterval(read, TICK_MS);
    };
    const onChange = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else onReturn();
    };
    // Some browsers restore a page from the back-forward cache with only pageshow, no visibility change. The first
    // load's pageshow isn't a restore, so it doesn't count.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && onReturn();
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pageshow', onPageShow);
    };
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
  // The URL that failed, rather than a flag reset by an effect: effects run again when a hidden page (Activity) is shown,
  // which would ask for dead art again each time. A new URL still gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, borderColor: rule?.color };
  if (card.imageUrl && card.imageUrl !== failed) {
    return <img className={thumb} style={style} src={card.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => (setFailed(card.imageUrl!), markBroken(card.imageUrl!))} />;
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

/**
 * The Fusion Up Kard plan's notes for one rarity, in the order the Plan shows them: with no rows, why nothing is
 * planned; with rows, the gear piece the leftover kards go to next. Gear that a step with no kard cost blocks is named
 * either way, since "not enough kards" would be wrong for it.
 */
export function kardNotes(plan: KardPlan, rule: RarityRule, cards: Map<string, Card>): string[] {
  if (plan.cards === 0)
    return [
      plan.realmKlash > 0
        ? `No ${rule.label} card at F${rule.fusionUpThreshold} or higher that kards can go to yet, so these kards wait. Realm Klash gear gets none.`
        : `No ${rule.label} card at F${rule.fusionUpThreshold} or higher yet, so these kards wait.`,
    ];
  const next = plan.next && cards.get(plan.next.cardId);
  const nextGoal = next && levelLabel(rule, targetLevel(next, rule));
  const short = plan.next ? plan.next.needs - plan.left : 0;
  const stuck = plan.stuck?.map((id) => cards.get(id)).filter((c) => c != null) ?? [];
  const stuckNote =
    stuck.length === 0
      ? null
      : stuck.length === 1
        ? `${stuck[0].name} can't reach ${levelLabel(rule, targetLevel(stuck[0], rule))} with kards: a step on the way has no kard cost in Settings → Fusion rules.`
        : `${stuck[0].name} and ${stuck.length - 1} more can't reach their goal with kards: a step on the way has no kard cost in Settings → Fusion rules.`;
  const notes: string[] = [];
  if (plan.assignments.length === 0) {
    notes.push(
      next && plan.next
        ? `Not enough kards to finish a piece yet: ${next.name} needs ${plan.next.needs} to reach ${nextGoal}, ${short} more than you have.`
        : (stuckNote ?? `Not enough kards for any step yet${plan.cheapest != null ? `: the cheapest next step costs ${plan.cheapest}.` : '.'}`),
    );
    if (next && stuckNote) notes.push(stuckNote);
    return notes;
  }
  if (next && plan.next) notes.push(`Next: ${next.name} needs ${plan.next.needs} kard${plan.next.needs === 1 ? '' : 's'} to reach ${nextGoal}${plan.left > 0 ? `, ${short} more than you have left` : ''}.`);
  if (stuckNote) notes.push(stuckNote);
  return notes;
}

/** How the Kard plan shares kards out, for the kinds that have kards: characters on cheapest steps, gear piece by piece. */
export function kardFooter(rarities: RarityRule[]) {
  const hasKards = (equipment: boolean) => rarities.some((r) => (r.kind === 'equipment') === equipment && r.fusionUpKards > 0);
  return (
    (hasKards(false) ? 'Character kards go to the cheapest steps first, since each step saves one pack copy. Guest cards count extra. ' : '') +
    (hasKards(true) ? 'Gear kards finish one piece at a time, the one needing fewest kards first, since gear only gets its special effect at F10. ' : '')
  );
}

const ONE_BUY = new Intl.NumberFormat('en', { maximumFractionDigits: 2, useGrouping: false });

/**
 * One card under a pack in the Pack ranking: its chance per buy, then how soon a copy comes. A Kasket of new cards
 * never repeats one, so it says within how many buys instead of an average; for its last card, where "100% per
 * buy" would say the same thing twice, just "yours next buy". One sure copy every buy, like a store item's, is just
 * "every buy", unless it comes from a Kasket of new cards (`once`), which gives it only once.
 */
export function targetLine(t: { card: { name: string }; pAtLeastOne: number; buysPerCopy: number; withinBuys?: number; once?: true }) {
  if (t.withinBuys === 1) return `${t.card.name}: yours next buy`;
  // Singular when the average shows as 1: rounded the way fmt rounds it, but in plain digits, since fmt follows the
  // locale's digits.
  const one = ONE_BUY.format(t.buysPerCopy) === '1';
  // One sure copy every buy, like a store item: "100% per buy · about 1 buy per copy" says it twice. Not a card a
  // Kasket of new cards gives once (`once`), and not a pack giving several copies a buy, whose average says how many.
  if (t.pAtLeastOne >= 1 && one && !t.once) return `${t.card.name}: every buy`;
  const when = t.withinBuys ? `yours within ${t.withinBuys} buys` : `about ${fmt(t.buysPerCopy)} buy${one ? '' : 's'} per copy`;
  return `${t.card.name}: ${pct(t.pAtLeastOne)} per buy · ${when}`;
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
