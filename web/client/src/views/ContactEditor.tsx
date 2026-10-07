import { useState } from 'react';
import type { Contact, ContactSection } from '../../../shared/types';
import { api } from '../api';
import { useChat } from '../chat/ChatContext';
import { SafeMarkdown } from '../markdown';
import { FileStatus } from '../ui';
import { useVersioned } from '../useVersioned';

const nameOf = (c: Contact) =>
  c.sections.find((s) => s.kind === 'table')?.fields.find(([k]) => k.toLowerCase() === 'name')?.[1] || c.title.replace(/^Contact:\s*/i, '') || c.slug;

function FieldsEditor({ fields, onChange }: { fields: [string, string][]; onChange(f: [string, string][]): void }) {
  const set = (i: number, j: 0 | 1, v: string) => onChange(fields.map((row, k) => (k === i ? (j === 0 ? [v, row[1]] : [row[0], v]) : row)));
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {fields.map(([k, v], i) => (
        <div className="row" key={i}>
          <input style={{ width: 160 }} aria-label="Field name" value={k} onChange={(e) => set(i, 0, e.target.value)} />
          <input style={{ flex: 1, width: 'auto' }} aria-label={k || 'Field value'} value={v} onChange={(e) => set(i, 1, e.target.value)} />
          <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(fields.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div><button type="button" onClick={() => onChange([...fields, ['', '']])}>Add field</button></div>
    </div>
  );
}

function SectionView({ s }: { s: ContactSection }) {
  if (s.kind !== 'raw') {
    return (
      <dl className="approval" style={{ border: 'none', background: 'none', padding: 0, margin: 0 }}>
        {s.fields.map(([k, v], i) => <div key={i} className="row"><dt style={{ width: 160 }}>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></div>)}
      </dl>
    );
  }
  return s.body.trim() ? <SafeMarkdown>{s.body}</SafeMarkdown> : <p className="muted">Empty</p>;
}

export function ContactEditor({ slug }: { slug: string }) {
  const res = useVersioned<Contact>(`/api/contacts/${encodeURIComponent(slug)}`, 'contacts', slug);
  const chat = useChat();
  const [draft, setDraft] = useState<{ data: Contact; baseHash: string } | null>(null);
  const [preview, setPreview] = useState<Record<number, boolean>>({});
  if (!res.data || !res.hash) {
    return (
      <>
        <a href="#/contacts">← Contacts</a>
        <FileStatus res={res} file={`contacts/${slug}.md`} />
      </>
    );
  }

  const view = draft?.data ?? res.data;
  const name = nameOf(view);
  const setSection = (i: number, patch: Partial<ContactSection>) =>
    setDraft((d) => d && { ...d, data: { ...d.data, sections: d.data.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } });
  const save = async () => { if (draft && (await res.save(draft.data, draft.baseHash))) setDraft(null); };
  const remove = async () => {
    if (!window.confirm(`Delete ${name}? This removes contacts/${slug}.md.`)) return;
    if (await res.run(() => api('DELETE', `/api/contacts/${encodeURIComponent(slug)}?hash=${res.hash}`))) window.location.hash = '#/contacts';
  };

  return (
    <>
      <a href="#/contacts">← Contacts</a>
      <div className="row">
        <h1 style={{ flex: 1 }}>{name}</h1>
        <button onClick={() => chat.send(`/enrich ${name}`)}>Enrich with Claude</button>
        {draft ? (
          <>
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setDraft({ data: structuredClone(res.data!), baseHash: res.hash! })}>Edit</button>
            <button className="danger" onClick={remove}>Delete</button>
          </>
        )}
      </div>
      <FileStatus res={res} file={`contacts/${slug}.md`} onReload={() => setDraft(null)} />
      {draft && (
        <div className="card form">
          <label className="wide">Title line<input value={draft.data.title} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, title: e.target.value } })} /></label>
          <details className="wide">
            <summary className="muted">Text above the first section</summary>
            <textarea rows={4} value={draft.data.preamble} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, preamble: e.target.value } })} />
          </details>
        </div>
      )}
      {view.sections.map((s, i) => (
        <section className="card" key={i}>
          <div className="row">
            <h2 style={{ flex: 1, margin: 0 }}>{s.heading}</h2>
            {draft && s.kind === 'raw' && <button onClick={() => setPreview({ ...preview, [i]: !preview[i] })}>{preview[i] ? 'Edit' : 'Preview'}</button>}
          </div>
          {!draft && <SectionView s={s} />}
          {draft && s.kind !== 'raw' && <FieldsEditor fields={s.fields} onChange={(fields) => setSection(i, { fields })} />}
          {draft && s.kind === 'raw' && (preview[i]
            ? <SafeMarkdown>{s.body}</SafeMarkdown>
            : <textarea rows={Math.max(3, s.body.split('\n').length + 1)} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} />)}
        </section>
      ))}
      {view.sections.length === 0 && !draft && view.preamble.trim() && <div className="card"><SafeMarkdown>{view.preamble}</SafeMarkdown></div>}
    </>
  );
}
