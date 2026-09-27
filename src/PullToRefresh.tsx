import { useEffect, useRef, useState } from 'react';

const TRIGGER_PX = 70;
const MAX_PX = 110;

/**
 * Pull down from the top of the page to refresh. Installed PWAs don't get the browser's own gesture,
 * so this listens for touches that start at scroll position 0 and calls onRefresh past the trigger distance.
 */
export default function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busy = useRef(false);

  useEffect(() => {
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      // Modals scroll on their own, so a pull inside one isn't a page pull.
      const inModal = (e.target as Element | null)?.closest?.('.modal-backdrop');
      start.current = !busy.current && window.scrollY <= 0 && !inModal && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      if (window.scrollY > 0) {
        start.current = null;
        set(0);
        return;
      }
      const dy = e.touches[0].clientY - start.current;
      // Resistance: the indicator moves at half the finger's speed.
      set(dy > 0 ? Math.min(dy * 0.5, MAX_PX) : 0);
    };
    const onEnd = async () => {
      if (start.current == null) return;
      start.current = null;
      const fire = pullRef.current >= TRIGGER_PX;
      set(0);
      if (!fire) return;
      busy.current = true;
      setRefreshing(true);
      try {
        // Keep the spinner up briefly even when the refresh is instant, so the gesture feels acknowledged.
        await Promise.all([refreshRef.current(), new Promise((r) => setTimeout(r, 500))]);
      } finally {
        busy.current = false;
        setRefreshing(false);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const offset = refreshing ? TRIGGER_PX * 0.8 : pull;
  if (offset === 0) return null;
  return (
    <div
      className={`ptr ${refreshing ? 'ptr-spin' : ''} ${pull >= TRIGGER_PX ? 'ptr-ready' : ''}`}
      style={{ transform: `translate(-50%, ${offset}px)`, opacity: refreshing ? 1 : Math.min(1, pull / TRIGGER_PX) }}
      role="status"
      aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
    >
      <span style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}>↻</span>
    </div>
  );
}
