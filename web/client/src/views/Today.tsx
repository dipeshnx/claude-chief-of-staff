import type { ReactNode } from 'react';
import type { ContactSummary, GoalsFile, TasksFile } from '../../../shared/types';
import { bucketTask, localToday } from '../../../shared/dates';
import { useChat } from '../chat/ChatContext';
import { FileStatus } from '../ui';
import { useList, useVersioned } from '../useVersioned';

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section>
      <h2>{title}</h2>
      {children.length ? <div className="card" style={{ padding: 0 }}>{children}</div> : <p className="muted">{empty}</p>}
    </section>
  );
}

export function TodayView() {
  const tasks = useVersioned<TasksFile>('/api/tasks', 'tasks');
  const goals = useVersioned<GoalsFile>('/api/goals', 'goals');
  const contacts = useList<ContactSummary>('/api/contacts', 'contacts');
  const chat = useChat();
  const today = localToday();
  const list = tasks.data?.tasks ?? [];
  const taskRow = (t: TasksFile['tasks'][number]) => (
    <a className="list-row" key={t.id} href="#/tasks" style={{ color: 'inherit', textDecoration: 'none' }}>
      <span className="grow">{t.title}</span>
      <span className="muted">{t.due_date}</span>
      <span className={`badge p${t.priority}`}>P{t.priority}</span>
    </a>
  );
  const atRisk = (goals.data?.objectives ?? []).filter((o) => o.status === 'at_risk' || o.status === 'behind');
  const stale = contacts.items.filter((c) => c.stale).sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9));

  return (
    <>
      <div className="row">
        <h1 style={{ flex: 1 }}>Today <span className="muted">· {today}</span></h1>
        <button className="primary" onClick={() => chat.send('/gm')}>Run /gm</button>
      </div>
      <FileStatus res={tasks} file="my-tasks.yaml" />
      <FileStatus res={goals} file="goals.yaml" />
      <Section title="Overdue" empty="Nothing overdue.">{list.filter((t) => bucketTask(t, today) === 'overdue').map(taskRow)}</Section>
      <Section title="Due today" empty="Nothing due today.">{list.filter((t) => bucketTask(t, today) === 'today').map(taskRow)}</Section>
      <Section title="Goals at risk" empty="All goals on track.">
        {atRisk.map((o) => (
          <a className="list-row" key={o.name} href="#/goals" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="grow">{o.name}</span>
            <span className="badge stale">{o.status?.replace('_', ' ')}</span>
          </a>
        ))}
      </Section>
      <Section title="Relationships going quiet" empty="No stale contacts.">
        {stale.map((c) => (
          <div className="list-row" key={c.slug}>
            <a className="grow" href={`#/contacts/${c.slug}`}>{c.name}</a>
            <span className="muted">{c.daysSince === null ? 'no interaction logged' : `${c.daysSince} days`}</span>
            <span className="badge">Tier {c.tier}</span>
            <button onClick={() => chat.send(`Suggest a touchpoint with ${c.name}. Check ~/.claude/contacts/${c.slug}.md for context.`)}>Suggest touchpoint</button>
          </div>
        ))}
      </Section>
    </>
  );
}
