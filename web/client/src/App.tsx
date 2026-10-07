import { useEffect, useState, type ReactNode } from 'react';
import type { Health } from '../../shared/types';
import { ApiError, api } from './api';
import { ChatProvider } from './chat/ChatContext';
import { ChatPane } from './chat/ChatPane';
import { SocketProvider } from './socket';
import { ChatsView } from './views/Chats';
import { ContactEditor } from './views/ContactEditor';
import { ContactsView } from './views/Contacts';
import { GoalsView } from './views/Goals';
import { SchedulesView } from './views/Schedules';
import { TasksView } from './views/Tasks';
import { TodayView } from './views/Today';

export type ViewId = 'today' | 'tasks' | 'goals' | 'contacts' | 'schedules' | 'chats';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'goals', label: 'Goals' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'chats', label: 'Chats' },
];

const VIEWS: Record<ViewId, (p: { param: string | null }) => ReactNode> = {
  today: () => <TodayView />,
  tasks: () => <TasksView />,
  goals: () => <GoalsView />,
  contacts: ({ param }) => (param ? <ContactEditor key={param} slug={param} /> : <ContactsView />),
  schedules: () => <SchedulesView />,
  chats: () => <ChatsView />,
};

function parseHash(): { view: ViewId; param: string | null } {
  const [, view, param] = window.location.hash.replace(/^#/, '').split('/');
  const known = NAV.some((n) => n.id === view);
  return { view: known ? (view as ViewId) : 'today', param: param ? decodeURIComponent(param) : null };
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Shell({ health }: { health: Health | null }) {
  const { view, param } = useHashRoute();
  const Body = VIEWS[view];
  const missing = health ? Object.entries(health.files).filter(([, ok]) => !ok).map(([k]) => k) : [];
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">Chief of Staff</div>
        {NAV.map((n) => <a key={n.id} href={`#/${n.id}`} className={n.id === view ? 'active' : ''}>{n.label}</a>)}
      </nav>
      <main className="main">
        {health && !health.claude.found && <div className="banner error">{health.claude.error} Chat is unavailable until this is fixed.</div>}
        {health?.claude.found && health.claude.error && <div className="banner warn"><code>claude --version</code> failed: {health.claude.error}</div>}
        {missing.length > 0 && <div className="banner warn">Missing from your Claude folder: {missing.join(', ')}. Run <code>./install.sh</code> from the repo root.</div>}
        <Body param={param} />
      </main>
      <ChatPane />
    </div>
  );
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => {
    api<Health>('GET', '/api/health').then(setHealth, (e) => { if (e instanceof ApiError && e.status === 401) setUnauthorized(true); });
  }, []);
  if (unauthorized) {
    return (
      <div className="fatal">
        <h1>Access link needed</h1>
        <p>Open the link printed in the terminal where you ran <code>npm start</code>. It includes this session's access token.</p>
      </div>
    );
  }
  return (
    <SocketProvider>
      <ChatProvider>
        <Shell health={health} />
      </ChatProvider>
    </SocketProvider>
  );
}
