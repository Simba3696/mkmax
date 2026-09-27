import { useEffect, useRef } from 'react';

const MIN_DX = 50;
const MAX_MS = 800;
/** Swipes starting this close to a screen edge belong to the OS (Safari's back/forward gesture). */
const EDGE_PX = 24;

/** True if the touch began on something that needs horizontal drags itself: a field, a modal, or a sideways scroller. */
function ownsHorizontalDrag(target: EventTarget | null) {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, select, textarea, .modal-backdrop')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/** Calls onSwipe(1) for a left swipe (next tab) and onSwipe(-1) for a right swipe (previous tab). */
export function useSwipeTabs(onSwipe: (dir: 1 | -1) => void) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0];
      start =
        e.touches.length === 1 && p.clientX > EDGE_PX && p.clientX < window.innerWidth - EDGE_PX && !ownsHorizontalDrag(e.target)
          ? { x: p.clientX, y: p.clientY, t: Date.now() }
          : null;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      const quick = Date.now() - start.t < MAX_MS;
      start = null;
      // Mostly sideways, so vertical scrolling never flips tabs.
      if (quick && Math.abs(dx) >= MIN_DX && Math.abs(dx) > 1.5 * Math.abs(dy)) cb.current(dx < 0 ? 1 : -1);
    };
    const onCancel = () => (start = null);
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, []);
}
