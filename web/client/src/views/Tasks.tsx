import { useState, type ChangeEvent } from 'react';
import type { GoalsFile, Task, TasksFile, TaskStatus } from '../../../shared/types';
import { bucketTask, localToday, type Bucket } from '../../../shared/dates';
import { api } from '../api';
import { useChat } from '../chat/ChatContext';
import { FileStatus } from '../ui';
import { useVersioned } from '../useVersioned';

const GROUPS: { id: Bucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
];
const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'blocked', 'complete'];
const PRIORITY: Record<number, string> = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

const byPriorityThenDue = (a: Task, b: Task) => a.priority - b.priority || (a.due_date || '9999').localeCompare(b.due_date || '9999');
/** New tasks shouldn't get `notes: ""` noise in the YAML. */
const compact = (t: Partial<Task>) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== '' && v !== undefined));

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function TaskForm({ initial, goalNames, submitLabel, onSubmit, onCancel }: {
  initial: Partial<Task>;
  goalNames: string[];
  submitLabel: string;
  onSubmit(t: Partial<Task>): void | Promise<void>;
  onCancel(): void;
}) {
  const [t, setT] = useState<Partial<Task>>(initial);
  const field = (k: keyof Task) => ({ value: String(t[k] ?? ''), onChange: (e: ChangeEvent<Field>) => setT({ ...t, [k]: e.target.value }) });
  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); void onSubmit({ ...t, priority: Number(t.priority ?? 3) }); }}>
      <label className="wide">Title<input required autoFocus {...field('title')} /></label>
      <label>Due date<input type="date" {...field('due_date')} /></label>
      <label>Priority<select {...field('priority')}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p} · {PRIORITY[p]}</option>)}</select></label>
      <label>Status<select {...field('status')}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
      <label>Goal<input list="goal-names" {...field('goal_alignment')} /></label>
      <datalist id="goal-names">{goalNames.map((n) => <option key={n} value={n} />)}</datalist>
      {!t.goal_alignment && <p className="warn-text wide">Not aligned to a goal. Does this advance anything in goals.yaml?</p>}
      <label className="wide">Description<textarea rows={2} {...field('description')} /></label>
      <label className="wide">Notes<textarea rows={2} {...field('notes')} /></label>
      <div className="row wide">
        <button type="submit" className="primary">{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function TasksView() {
  const res = useVersioned<TasksFile>('/api/tasks', 'tasks');
  const goals = useVersioned<GoalsFile>('/api/goals', 'goals');
  const chat = useChat();
  const [editing, setEditing] = useState<{ id: string; baseHash: string; task: Task } | null>(null);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  if (!res.data || !res.hash) return <FileStatus res={res} file="my-tasks.yaml" />;

  const { data, hash } = res;
  const today = localToday();
  const goalNames = goals.data?.objectives.map((o) => o.name) ?? [];
  const update = (task: Task, baseHash: string) => res.save({ ...data, tasks: data.tasks.map((t) => (t.id === task.id ? task : t)) }, baseHash);
  const remove = (task: Task) => {
    if (window.confirm(`Delete "${task.title}"?`)) void res.run(() => api('DELETE', `/api/tasks/${encodeURIComponent(task.id)}?hash=${hash}`));
  };
  const add = async (fields: Partial<Task>) => {
    if (await res.run(() => api('POST', '/api/tasks', { task: compact(fields), hash }))) setAdding(false);
  };

  const row = (t: Task) => (
    <div className="list-row" key={t.id}>
      <input
        type="checkbox"
        style={{ width: 'auto' }}
        aria-label={`Mark ${t.title} complete`}
        checked={t.status === 'complete'}
        onChange={(e) => void update({ ...t, status: e.target.checked ? 'complete' : 'pending' }, hash)}
      />
      <div className="grow">
        <div>{t.title} <span className="muted">{t.id}</span>{editing?.id === t.id && <span className="badge"> editing…</span>}</div>
        <div className="muted">
          {t.due_date ? `due ${t.due_date}` : 'no due date'} · {t.goal_alignment || 'no goal'}
          {(t.status === 'in_progress' || t.status === 'blocked') && ` · ${t.status.replace('_', ' ')}`}
        </div>
      </div>
      <span className={`badge p${t.priority}`}>P{t.priority}</span>
      <button onClick={() => chat.send(`Work on ${t.id}: ${t.title}`)}>Execute with Claude</button>
      <button onClick={() => setEditing({ id: t.id, baseHash: hash, task: t })}>Edit</button>
      <button className="danger" onClick={() => remove(t)}>Delete</button>
    </div>
  );

  const done = data.tasks.filter((t) => bucketTask(t, today) === 'done');
  return (
    <>
      <div className="row">
        <h1 style={{ flex: 1 }}>Tasks</h1>
        <button className="primary" onClick={() => setAdding(true)}>Add task</button>
      </div>
      <FileStatus res={res} file="my-tasks.yaml" onReload={() => setEditing(null)} />
      {editing && (
        <div key={editing.id}>
          {!data.tasks.some((t) => t.id === editing.id) && (
            <p className="warn-text">This task was changed or removed outside the UI; saving will report a conflict.</p>
          )}
          <TaskForm
            initial={editing.task}
            goalNames={goalNames}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onSubmit={async (next) => { if (await update({ ...editing.task, ...next } as Task, editing.baseHash)) setEditing(null); }}
          />
        </div>
      )}
      {adding && <TaskForm initial={{ status: 'pending', priority: 3 }} goalNames={goalNames} submitLabel="Add" onCancel={() => setAdding(false)} onSubmit={add} />}
      {GROUPS.map((g) => {
        const list = data.tasks.filter((t) => bucketTask(t, today) === g.id).sort(byPriorityThenDue);
        return list.length === 0 ? null : (
          <section key={g.id}>
            <h2>{g.label} ({list.length})</h2>
            <div className="card" style={{ padding: 0 }}>{list.map(row)}</div>
          </section>
        );
      })}
      {data.tasks.length === 0 && !adding && <p className="muted">No tasks yet. Add one, or ask Claude: “/my-tasks add …”.</p>}
      {done.length > 0 && (
        <section>
          <h2><button onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} completed ({done.length})</button></h2>
          {showDone && <div className="card" style={{ padding: 0 }}>{done.map(row)}</div>}
        </section>
      )}
    </>
  );
}
