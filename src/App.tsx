import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchStarterData, useStore, type SyncStatus, type UndoEntry } from './store';
import { btn } from './classes';
import PullToRefresh from './PullToRefresh';
import { slideIn, useSwipeTabs } from './useSwipeTabs';
import { scrollRoot } from './scrollRoot';
import { catalogImageUpdates, loadCatalog, wantsCatalogImage } from './catalog';
import { buildCtx, buildPlan, endingSoon, moveSeasonEnd, seasonEnd } from './engine';
import { refreshEvents, scheduledSeason, useEvents } from './events';
import { checkForAppUpdate } from './appUpdate';
import { useNow } from './ui';
import { CardsIcon, PacksIcon, PlanIcon, SettingsIcon } from './icons';
import { syncLabel } from './views/SyncPanel';
import PlanView from './views/PlanView';
import PacksView, { type PackFocus } from './views/PacksView';
import CardsView from './views/CardsView';
import SettingsView from './views/SettingsView';

const TABS = [
  { id: 'plan', label: 'Plan', Icon: PlanIcon },
  { id: 'packs', label: 'Packs', Icon: PacksIcon },
  { id: 'cards', label: 'Cards', Icon: CardsIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

const UNDO_SHOW_MS = 8000;

/** Sync status pill colors; the pill opens Settings. */
const SYNC_PILL: Record<SyncStatus['kind'], string> = {
  off: '',
  idle: 'border-transparent text-ok',
  syncing: 'border-transparent text-muted',
  error: 'border-red text-error',
  conflict: 'border-red text-error',
};

function UndoToast({ entry, onUndo, onDismiss }: { entry: UndoEntry; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, UNDO_SHOW_MS);
    return () => clearTimeout(t);
    // Restart the timer for each new change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.at]);
  return (
    // Above the tab bar on phones; on wider screens, centred over the content beside the rail.
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[8] bottom-[calc(70px+env(safe-area-inset-bottom))] md:bottom-6 md:left-[calc(50%+44px)] lg:left-[calc(50%+110px)] w-[calc(100%-2rem)] max-w-[480px] flex items-center gap-[0.3rem] bg-panel-2 border border-line rounded-card py-[0.3rem] pr-[0.3rem] pl-[0.9rem] shadow-[0_4px_16px_rgba(0,0,0,0.6)] text-[0.9rem]"
      role="status"
    >
      <span className="flex-1 min-w-0 truncate">{entry.label}</span>
      <button className={`${btn.ghost} text-gold font-bold`} onClick={onUndo}>
        Undo
      </button>
      <button className={btn.ghost} onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const { state, update, replace, sync, lastUndo, undo, dismissUndo } = useStore();
  const [tab, setTab] = useState<TabId>(() => (location.hash.slice(1) as TabId) || 'plan');

  // ?starter loads the OneNote starter data, but only into an empty app so it never overwrites real progress.
  useEffect(() => {
    const url = new URL(location.href);
    if (!url.searchParams.has('starter')) return;
    url.searchParams.delete('starter');
    history.replaceState(null, '', url);
    if (state.cards.length === 0) fetchStarterData().then(replace, (e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Give cards MK Mobile Base art automatically: new cards, cards synced in from another device, and cards still
  // carrying art from the old wiki lookup. Runs again only when that set of cards changes.
  const needsArt = state.cards.filter(wantsCatalogImage).map((c) => c.id).join(',');
  useEffect(() => {
    if (!needsArt) return;
    let cancelled = false;
    loadCatalog().then(
      (items) => {
        if (cancelled) return;
        const updates = catalogImageUpdates(state.cards, new Map(state.rarities.map((r) => [r.id, r])), items);
        if (updates.size) update((d) => d.cards.forEach((c) => Object.assign(c, updates.get(c.id) ?? {})), undefined, { auto: true });
      },
      () => {}, // offline or no catalog: Find images still works later
    );
    return () => void (cancelled = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsArt]);

  // MK Mobile Base's schedule knows when the Realm Klash season ends, so it replaces the saved date (and the
  // 2-week guess) whenever it covers today, moving that season's items with it.
  const events = useEvents();
  const now = useNow();
  const season = scheduledSeason(events, now);
  const scheduledEnd = season?.end ?? null;
  const savedEnd = seasonEnd(state.realmKlashSeasonEnd, now);
  useEffect(() => {
    if (!scheduledEnd || scheduledEnd === savedEnd) return;
    // Wait for this launch's first sync: another device has often made the move already, and moving first would
    // turn its pull into a "which copy" prompt.
    if (!sync.settled) return;
    // Which packs this moves depends on when it runs, so it's a real change that syncs. The exception is a fresh
    // install, which has nothing to move: stamping it would make a new device ask which copy to keep when it joins.
    update((d) => moveSeasonEnd(d, scheduledEnd, now, season?.weekEnds), undefined, { auto: !state.updatedAt && state.packs.length === 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledEnd, savedEnd, sync.settled]);

  const pageRef = useRef<HTMLDivElement>(null);
  /** Direction the next tab change should slide in from, set by go() and used once the new tab has rendered. */
  const enterDir = useRef<1 | -1 | 0>(0);
  const tabIndex = (t: TabId) => TABS.findIndex((x) => x.id === t);
  /** Pack to scroll to when the Packs tab opens, set by tapping a pack in the plan. */
  const [focusPack, setFocusPack] = useState<PackFocus | null>(null);
  const openPack = (id: string, pull = false) => {
    setFocusPack({ id, pull });
    go('packs');
  };
  // Packs the plan says to buy that end within a day: a count on the Packs tab and, where the phone supports it,
  // on the home-screen icon.
  const soon = useMemo(() => endingSoon(buildPlan(buildCtx(state), now), now).length, [state, now]);
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    (soon ? navigator.setAppBadge(soon) : navigator.clearAppBadge()).catch(() => {});
  }, [soon]);
  const go = (t: TabId) => {
    if (t === tab) return;
    enterDir.current = tabIndex(t) > tabIndex(tab) ? 1 : -1;
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  // After the new tab renders (before paint): start it at the top and slide it in.
  useLayoutEffect(() => {
    const root = scrollRoot();
    if (root) root.scrollTop = 0;
    const dir = enterDir.current;
    enterDir.current = 0;
    if (dir && pageRef.current) slideIn(pageRef.current, dir);
  }, [tab]);
  // Swipe left for the next tab, right for the previous one; stops at the ends instead of wrapping.
  useSwipeTabs({
    page: () => pageRef.current,
    canGo: (dir) => !!TABS[tabIndex(tab) + dir],
    onSwipe: (dir) => {
      const next = TABS[tabIndex(tab) + dir];
      if (next) go(next.id);
    },
  });
  // With sync on, a pull checks the gist and re-reads the event schedule. Without sync there's nothing remote to
  // fetch, so reload, which picks up app updates and the schedule too.
  const refresh = () => (sync.connected ? Promise.all([sync.syncNow(), refreshEvents(), checkForAppUpdate()]) : Promise.resolve(location.reload()));

  const syncPill = (extra: string) =>
    sync.status.kind !== 'off' && (
      <button
        className={`${extra} min-h-[28px] py-[2px] px-[10px] rounded-full bg-transparent border text-small ${SYNC_PILL[sync.status.kind]}`}
        onClick={() => go('settings')}
        title="Sync settings"
      >
        {syncLabel(sync.status)}
      </button>
    );
  const tabButton = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      className={`flex-1 max-w-[180px] md:flex-none md:max-w-none md:w-full flex flex-col lg:flex-row items-center gap-[2px] lg:gap-3 bg-transparent border-0 rounded-none md:rounded-panel pt-2 pb-[0.6rem] px-0 md:py-2 lg:py-[0.6rem] lg:px-3 text-[0.75rem] lg:text-[0.95rem] ${
        tab === t.id
          ? 'text-fg shadow-[inset_0_2px_0_var(--color-red)] md:shadow-[inset_3px_0_0_var(--color-red)] md:bg-panel-2'
          : 'text-muted md:hover:bg-panel md:hover:text-fg'
      }`}
      aria-current={tab === t.id ? 'page' : undefined}
      onClick={() => go(t.id)}
    >
      <span className={`flex relative ${tab === t.id ? 'text-red' : ''}`}>
        <t.Icon />
        {t.id === 'packs' && soon > 0 && (
          <span
            className="absolute -top-[5px] -right-[9px] min-w-[16px] h-[16px] px-[4px] rounded-full bg-red text-white text-[0.65rem] font-bold leading-[16px] text-center"
            aria-label={`${soon} planned pack${soon === 1 ? '' : 's'} ending within a day`}
          >
            {soon}
          </span>
        )}
      </span>
      <span>{t.label}</span>
    </button>
  );
  const logo = (
    <span className="inline-flex items-center gap-[0.45rem] font-black tracking-[0.08em] text-[1.2rem]">
      <img className="size-[26px]" src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
      <span className="inline-flex gap-[0.45rem] md:max-lg:sr-only">
        MK<b className="text-red">MAX</b>
      </span>
    </span>
  );

  // Phones: header on top, tab bar along the bottom. From 768px wide: a rail on the left with the logo, the main
  // tabs, then sync status and Settings at the bottom; the header goes away.
  return (
    <div className="h-dvh flex flex-col md:flex-row touch-pan-y touch-pinch-zoom">
      <PullToRefresh onRefresh={refresh} />
      <header className="md:hidden flex-none relative z-[5] flex items-center gap-[0.6rem] px-[max(1rem,calc((100%-720px)/2+1rem))] pt-[calc(0.7rem+env(safe-area-inset-top))] pb-[0.7rem] bg-linear-to-b from-[#1c0d0c] to-bg border-b border-line">
        {logo}
        <span className="text-muted text-small">Pack planner</span>
        {syncPill('ml-auto')}
      </header>
      <main data-scroll-root className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="max-w-page md:max-w-[1400px] mx-auto p-4 md:px-6 md:py-6 lg:px-8" ref={pageRef}>
          {tab === 'plan' && <PlanView goto={go} openPack={openPack} />}
          {tab === 'packs' && <PacksView focus={focusPack} onFocused={() => setFocusPack(null)} />}
          {tab === 'cards' && <CardsView />}
          {tab === 'settings' && <SettingsView />}
        </div>
      </main>
      {lastUndo && <UndoToast entry={lastUndo} onUndo={undo} onDismiss={dismissUndo} />}
      <nav
        aria-label="Tabs"
        className="flex-none relative z-[5] flex justify-center bg-bar border-t border-line pb-[env(safe-area-inset-bottom)] md:order-first md:flex-col md:justify-start md:gap-1 md:w-[88px] lg:w-[220px] md:border-t-0 md:border-r md:px-2 md:pt-[calc(0.9rem+env(safe-area-inset-top))] md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <div className="hidden md:flex items-center justify-center lg:justify-start lg:px-3 mb-4">{logo}</div>
        {TABS.filter((t) => t.id !== 'settings').map(tabButton)}
        {/* On phones this wrapper vanishes, so Settings is just the last tab; on the rail it sits at the bottom. */}
        <div className="contents md:flex md:flex-col md:gap-2 md:mt-auto">
          {syncPill(
            'hidden md:block md:w-full md:text-center md:whitespace-normal md:text-balance md:rounded-panel md:px-1 md:text-[0.7rem] md:leading-tight lg:rounded-full lg:px-[10px] lg:text-small lg:leading-normal',
          )}
          {tabButton(TABS[TABS.length - 1])}
        </div>
      </nav>
    </div>
  );
}
