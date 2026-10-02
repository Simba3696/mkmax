import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchStarterData, useStore, type UndoEntry } from './store';
import PullToRefresh from './PullToRefresh';
import { slideIn, useSwipeTabs } from './useSwipeTabs';
import { scrollRoot } from './scrollRoot';
import { catalogImageUpdates, loadCatalog, wantsCatalogImage } from './catalog';
import { buildCtx, buildPlan, endingSoon, moveSeasonEnd, seasonEnd } from './engine';
import { refreshEvents, scheduledSeasonEnd, useEvents } from './events';
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

function UndoToast({ entry, onUndo, onDismiss }: { entry: UndoEntry; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, UNDO_SHOW_MS);
    return () => clearTimeout(t);
    // Restart the timer for each new change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.at]);
  return (
    <div className="toast" role="status">
      <span className="grow">{entry.label}</span>
      <button className="ghost toast-undo" onClick={onUndo}>
        Undo
      </button>
      <button className="ghost" onClick={onDismiss} aria-label="Dismiss">
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
        if (updates.size) update((d) => d.cards.forEach((c) => Object.assign(c, updates.get(c.id) ?? {})));
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
  const scheduledEnd = scheduledSeasonEnd(events, now);
  const savedEnd = seasonEnd(state.realmKlashSeasonEnd, now);
  useEffect(() => {
    if (scheduledEnd && scheduledEnd !== savedEnd) update((d) => moveSeasonEnd(d, scheduledEnd, now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledEnd, savedEnd]);

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

  return (
    <div className="app">
      <PullToRefresh onRefresh={refresh} />
      <header className="topbar column-gutter">
        <span className="logo">
          <img className="logo-mark" src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
          MK<b>MAX</b>
        </span>
        <span className="muted small">Pack planner</span>
        {sync.status.kind !== 'off' && (
          <button className={`sync-pill ghost small sync-${sync.status.kind}`} onClick={() => go('settings')} title="Sync settings">
            {syncLabel(sync.status)}
          </button>
        )}
      </header>
      <main className="content">
        <div className="page" ref={pageRef}>
          {tab === 'plan' && <PlanView goto={go} openPack={openPack} />}
          {tab === 'packs' && <PacksView focus={focusPack} onFocused={() => setFocusPack(null)} />}
          {tab === 'cards' && <CardsView />}
          {tab === 'settings' && <SettingsView />}
        </div>
      </main>
      {lastUndo && <UndoToast entry={lastUndo} onUndo={undo} onDismiss={dismissUndo} />}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => go(t.id)}>
            <span className="tab-icon">
              <t.Icon />
              {t.id === 'packs' && soon > 0 && (
                <span className="tab-badge" aria-label={`${soon} planned pack${soon === 1 ? '' : 's'} ending within a day`}>
                  {soon}
                </span>
              )}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
