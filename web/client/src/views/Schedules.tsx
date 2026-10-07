import { useState } from 'react';
import type { Schedule, SchedulesFile } from '../../../shared/types';
import { useChat } from '../chat/ChatContext';
import { FileStatus } from '../ui';
import { useVersioned } from '../useVersioned';

export function SchedulesView() {
  const res = useVersioned<SchedulesFile>('/api/schedules', 'schedules');
  const chat = useChat();
  const [draft, setDraft] = useState<{ data: SchedulesFile; baseHash: string } | null>(null);
  if (!res.data || !res.hash) return <FileStatus res={res} file="schedules.yaml" />;

  const view = draft?.data ?? res.data;
  const setRow = (i: number, patch: Partial<Schedule>) =>
    setDraft((d) => d && { ...d, data: { ...d.data, schedules: d.data.schedules.map((s, j) => (j === i ? { ...s, ...patch } : s)) } });
  const save = async () => { if (draft && (await res.save(draft.data, draft.baseHash))) setDraft(null); };

  return (
    <>
      <div className="row">
        <h1 style={{ flex: 1 }}>Schedules</h1>
        {draft ? (
          <>
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setDraft({ data: structuredClone(res.data!), baseHash: res.hash! })}>Edit</button>
        )}
      </div>
      <FileStatus res={res} file="schedules.yaml" onReload={() => setDraft(null)} />
      <p className="muted">The web UI doesn't run schedules automatically yet. Use “Run now”, or set up cron as described in schedules.yaml.</p>
      <div className="card" style={{ padding: 0 }}>
        {view.schedules.map((s, i) =>
          draft ? (
            <div className="list-row form" key={i}>
              <label>Name<input value={s.name} onChange={(e) => setRow(i, { name: e.target.value })} /></label>
              <label>Skill<input value={s.skill} onChange={(e) => setRow(i, { skill: e.target.value })} /></label>
              <label>Frequency<input value={s.frequency ?? ''} onChange={(e) => setRow(i, { frequency: e.target.value })} /></label>
              <label>Enabled<input type="checkbox" style={{ width: 'auto' }} checked={s.enabled ?? false} onChange={(e) => setRow(i, { enabled: e.target.checked })} /></label>
              <label className="wide">Notes<input value={s.notes ?? ''} onChange={(e) => setRow(i, { notes: e.target.value })} /></label>
              <button className="danger" onClick={() => setDraft((d) => d && { ...d, data: { ...d.data, schedules: d.data.schedules.filter((_, j) => j !== i) } })}>Remove</button>
            </div>
          ) : (
            <div className="list-row" key={i}>
              <div className="grow">
                <div>{s.name} <code>{s.skill}</code></div>
                <div className="muted">{s.frequency}{s.notes ? ` · ${s.notes}` : ''}</div>
              </div>
              <span className={`badge ${s.enabled ? 'ok' : ''}`}>{s.enabled ? 'enabled' : 'disabled'}</span>
              <button onClick={() => chat.send(s.skill)}>Run now</button>
            </div>
          ),
        )}
      </div>
      {draft && (
        <button onClick={() => setDraft({ ...draft, data: { ...draft.data, schedules: [...draft.data.schedules, { name: '', skill: '/', frequency: '', enabled: false, notes: '' }] } })}>
          Add schedule
        </button>
      )}
    </>
  );
}
