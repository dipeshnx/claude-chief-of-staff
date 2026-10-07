import { useState } from 'react';
import type { GoalsFile, GoalStatus, Objective } from '../../../shared/types';
import { FileStatus } from '../ui';
import { useVersioned } from '../useVersioned';

const STATUSES: GoalStatus[] = ['on_track', 'at_risk', 'behind', 'complete'];
const statusClass = (s?: GoalStatus) => (s === 'at_risk' || s === 'behind' ? 'stale' : s === 'complete' ? 'ok' : '');

function GoalCard({ o }: { o: Objective }) {
  const pct = Math.round((o.progress ?? 0) * 100);
  return (
    <div className="card">
      <div className="row">
        <strong style={{ flex: 1 }}>{o.name}</strong>
        {o.priority != null && <span className="badge">P{o.priority}</span>}
        {o.status && <span className={`badge ${statusClass(o.status)}`}>{o.status.replace('_', ' ')}</span>}
      </div>
      {o.target && <p className="muted">{o.target}</p>}
      <div className="row"><div className="progress" style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></div><span className="muted">{pct}%</span></div>
      {o.key_results && o.key_results.length > 0 && <ul>{o.key_results.map((kr, i) => <li key={i}>{kr}</li>)}</ul>}
      {o.notes && <p className="muted">{o.notes}</p>}
    </div>
  );
}

function GoalEditor({ o, onChange, onRemove }: { o: Objective; onChange(patch: Partial<Objective>): void; onRemove(): void }) {
  return (
    <div className="card form">
      <label className="wide">Name<input required value={o.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className="wide">Target<input value={o.target ?? ''} onChange={(e) => onChange({ target: e.target.value })} /></label>
      <label>Priority<input type="number" min={1} value={o.priority ?? ''} onChange={(e) => onChange({ priority: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
      <label>Status
        <select value={o.status ?? 'on_track'} onChange={(e) => onChange({ status: e.target.value as GoalStatus })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label>Progress {Math.round((o.progress ?? 0) * 100)}%
        <input type="range" min={0} max={1} step={0.05} value={o.progress ?? 0} onChange={(e) => onChange({ progress: Number(e.target.value) })} />
      </label>
      <label className="wide">Key results (one per line)
        <textarea rows={3} value={(o.key_results ?? []).join('\n')} onChange={(e) => onChange({ key_results: e.target.value.split('\n') })} />
      </label>
      <label className="wide">Notes<textarea rows={2} value={o.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} /></label>
      <div className="row wide"><button type="button" className="danger" onClick={onRemove}>Remove objective</button></div>
    </div>
  );
}

export function GoalsView() {
  const res = useVersioned<GoalsFile>('/api/goals', 'goals');
  const [draft, setDraft] = useState<{ data: GoalsFile; baseHash: string } | null>(null);
  if (!res.data || !res.hash) return <FileStatus res={res} file="goals.yaml" />;

  const view = draft?.data ?? res.data;
  const setObjectives = (fn: (list: Objective[]) => Objective[]) =>
    setDraft((d) => d && { ...d, data: { ...d.data, objectives: fn(d.data.objectives) } });
  const save = async () => {
    if (!draft) return;
    const data = { ...draft.data, objectives: draft.data.objectives.map((o) => ({ ...o, key_results: o.key_results?.map((k) => k.trim()).filter(Boolean) })) };
    if (await res.save(data, draft.baseHash)) setDraft(null);
  };

  return (
    <>
      <div className="row">
        <h1 style={{ flex: 1 }}>Goals {view.quarter && <span className="muted">· {view.quarter}</span>}</h1>
        {draft ? (
          <>
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setDraft({ data: structuredClone(res.data!), baseHash: res.hash! })}>Edit</button>
        )}
      </div>
      <FileStatus res={res} file="goals.yaml" onReload={() => setDraft(null)} />
      {view.last_updated && <p className="muted">Last updated {view.last_updated}</p>}
      {draft && (
        <label>Quarter<input value={draft.data.quarter ?? ''} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, quarter: e.target.value } })} /></label>
      )}
      {view.objectives.map((o, i) =>
        draft ? (
          <GoalEditor
            key={i}
            o={o}
            onChange={(patch) => setObjectives((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
            onRemove={() => setObjectives((list) => list.filter((_, j) => j !== i))}
          />
        ) : (
          <GoalCard key={i} o={o} />
        ),
      )}
      {draft && (
        <button onClick={() => setObjectives((list) => [...list, { name: '', priority: list.length + 1, key_results: [], progress: 0, status: 'on_track', notes: '' }])}>
          Add objective
        </button>
      )}
      {view.objectives.length === 0 && !draft && <p className="muted">No objectives yet. Click Edit to add 3–5.</p>}
    </>
  );
}
