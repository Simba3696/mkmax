import { useEffect, useRef } from 'react';

/** Movement before a touch counts as a sideways drag (or a vertical scroll, which cancels it). */
const LOCK_PX = 10;
/** Release past this share of the screen width, or a quick flick, to switch tabs. */
const COMMIT_SHARE = 0.25;
const FLICK_PX = 50;
const FLICK_MS = 300;
/** Swipes starting this close to a screen edge belong to the OS (Safari's back/forward gesture). */
const EDGE_PX = 24;
const OUT_MS = 160;
const IN_MS = 220;

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** True if the touch began on something that needs horizontal drags itself: a field, a modal, or a sideways scroller. */
function ownsHorizontalDrag(target: EventTarget | null) {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, select, textarea, [data-modal]')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/** Clears inline animation styles so the page has no transform at rest (a transform would break fixed-position modals). */
function settle(el: HTMLElement) {
  el.style.transition = '';
  el.style.transform = '';
  el.style.opacity = '';
}

/**
 * Slide a freshly shown tab in from the side it came from: dir 1 = next tab (enters from the right),
 * -1 = previous tab (enters from the left).
 */
export function slideIn(el: HTMLElement, dir: 1 | -1) {
  if (prefersReducedMotion()) return settle(el);
  el.style.transition = 'none';
  el.style.transform = `translateX(${dir * 100}%)`;
  el.style.opacity = '0.4';
  el.getBoundingClientRect(); // commit the start position before animating
  el.style.transition = `transform ${IN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${IN_MS}ms ease-out`;
  el.style.transform = 'translateX(0)';
  el.style.opacity = '1';
  const done = () => settle(el);
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, IN_MS + 50); // in case transitionend never fires
}

/**
 * Swipe between tabs. The page follows the finger; letting go past a quarter of the screen (or flicking) slides
 * it out and calls onSwipe(1) for the next tab or onSwipe(-1) for the previous one. At either end the page only
 * stretches a little and springs back. Vertical scrolling is left alone.
 */
export function useSwipeTabs({ page, canGo, onSwipe }: { page: () => HTMLElement | null; canGo: (dir: 1 | -1) => boolean; onSwipe: (dir: 1 | -1) => void }) {
  const opts = useRef({ page, canGo, onSwipe });
  opts.current = { page, canGo, onSwipe };

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    let mode: 'undecided' | 'swipe' | 'scroll' = 'undecided';
    let dx = 0;

    const onStart = (e: TouchEvent) => {
      const p = e.touches[0];
      const ok = e.touches.length === 1 && p.clientX > EDGE_PX && p.clientX < window.innerWidth - EDGE_PX && !ownsHorizontalDrag(e.target);
      start = ok ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
      mode = 'undecided';
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!start || mode === 'scroll') return;
      const p = e.touches[0];
      const mx = p.clientX - start.x;
      const my = p.clientY - start.y;
      if (mode === 'undecided') {
        if (Math.abs(my) > LOCK_PX && Math.abs(my) >= Math.abs(mx)) return void (mode = 'scroll');
        if (Math.abs(mx) > LOCK_PX && Math.abs(mx) > 1.5 * Math.abs(my)) mode = 'swipe';
        else return;
      }
      // Sideways drag: keep the content from also scrolling vertically.
      if (e.cancelable) e.preventDefault();
      const dir: 1 | -1 = mx < 0 ? 1 : -1;
      // No tab that way: resist, so the page only stretches a little.
      dx = opts.current.canGo(dir) ? mx : mx * 0.25;
      const el = opts.current.page();
      if (!el || prefersReducedMotion()) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / window.innerWidth));
    };

    const onEnd = () => {
      if (!start) return;
      const quick = Date.now() - start.t < FLICK_MS;
      const wasSwipe = mode === 'swipe';
      start = null;
      mode = 'undecided';
      if (!wasSwipe) return;
      const el = opts.current.page();
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const commit = opts.current.canGo(dir) && (Math.abs(dx) > window.innerWidth * COMMIT_SHARE || (quick && Math.abs(dx) > FLICK_PX));
      if (!el || prefersReducedMotion()) {
        if (el) settle(el);
        if (commit) opts.current.onSwipe(dir);
        return;
      }
      if (!commit) {
        // Spring back.
        el.style.transition = `transform ${OUT_MS}ms ease-out, opacity ${OUT_MS}ms ease-out`;
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
        const done = () => settle(el);
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, OUT_MS + 50);
        return;
      }
      // Slide the current tab out, then switch; the new tab slides in (see slideIn).
      el.style.transition = `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`;
      el.style.transform = `translateX(${-dir * 100}%)`;
      el.style.opacity = '0.4';
      setTimeout(() => opts.current.onSwipe(dir), OUT_MS);
    };

    const onCancel = () => {
      const el = opts.current.page();
      if (el && mode === 'swipe') settle(el);
      start = null;
      mode = 'undecided';
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a sideways drag cancels the vertical scroll it would otherwise cause.
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, []);
}
