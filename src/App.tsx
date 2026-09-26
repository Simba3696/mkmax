import { useState } from 'react';
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

export default function App() {
  const [tab, setTab] = useState<TabId>(() => (location.hash.slice(1) as TabId) || 'plan');
  const go = (t: TabId) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">MK<b>MAX</b></span>
        <span className="muted small">Pack planner</span>
      </header>
      <main className="content">
        {tab === 'plan' && <PlanView goto={go} />}
        {tab === 'packs' && <PacksView />}
        {tab === 'cards' && <CardsView />}
        {tab === 'settings' && <SettingsView />}
      </main>
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
