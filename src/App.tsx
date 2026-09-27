import { useEffect, useState } from 'react';
import { fetchStarterData, useStore, type UndoEntry } from './store';
import PullToRefresh from './PullToRefresh';
import { syncLabel } from './views/SyncPanel';
import PlanView from './views/PlanView';
import PacksView from './views/PacksView';
import CardsView from './views/CardsView';
import SettingsView from './views/SettingsView';

const TABS = [
  { id: 'plan', label: 'Plan', icon: '🎯' },
  { id: 'packs', label: 'Packs', icon: '🎁' },
  { id: 'cards', label: 'Cards', icon: '🃏' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
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
  const { state, replace, sync, lastUndo, undo, dismissUndo } = useStore();
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
  const go = (t: TabId) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo(0, 0);
  };
  // With sync on, a pull checks the gist. Without it there's nothing remote to fetch, so reload to pick up app updates.
  const refresh = () => (sync.connected ? sync.syncNow() : Promise.resolve(location.reload()));

  return (
    <div className="app">
      <PullToRefresh onRefresh={refresh} />
      <header className="topbar">
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
        {tab === 'plan' && <PlanView goto={go} />}
        {tab === 'packs' && <PacksView />}
        {tab === 'cards' && <CardsView />}
        {tab === 'settings' && <SettingsView />}
      </main>
      {lastUndo && <UndoToast entry={lastUndo} onUndo={undo} onDismiss={dismissUndo} />}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => go(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
