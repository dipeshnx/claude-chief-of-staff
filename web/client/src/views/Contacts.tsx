import { useState } from 'react';
import type { ContactSummary } from '../../../shared/types';
import { api } from '../api';
import { errorText } from '../ui';
import { useList } from '../useVersioned';

export function ContactsView() {
  const list = useList<ContactSummary>('/api/contacts', 'contacts');
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<unknown>(null);

  const create = async () => {
    setError(null);
    try {
      const r = await api<{ slug: string }>('POST', '/api/contacts', { name: newName });
      setNewName('');
      window.location.hash = `#/contacts/${r.slug}`;
    } catch (e) {
      setError(e);
    }
  };
  const q = filter.toLowerCase();
  const shown = list.items.filter((c) => `${c.name} ${c.role ?? ''}`.toLowerCase().includes(q));

  return (
    <>
      <h1>Contacts</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void create(); }} style={{ marginBottom: 12 }}>
        <input style={{ flex: 1, width: 'auto' }} placeholder="New contact name, e.g. Pat Rivera" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="primary" disabled={!newName.trim()}>Create</button>
      </form>
      {error != null && <div className="banner error">{errorText(error)}</div>}
      {list.error != null && <div className="banner error">{errorText(list.error)}</div>}
      <input placeholder="Filter by name or role" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="card" style={{ padding: 0 }}>
        {shown.map((c) => (
          <a className="list-row" key={c.slug} href={`#/contacts/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="grow">
              <div>{c.name}</div>
              <div className="muted">{c.role ?? ''}</div>
            </div>
            {c.tier !== null && <span className="badge">Tier {c.tier}</span>}
            <span className="muted">{c.lastInteraction ?? 'never'}</span>
            {c.tier !== null && <span className={`badge ${c.stale ? 'stale' : 'ok'}`}>{c.stale ? 'stale' : 'ok'}</span>}
          </a>
        ))}
      </div>
      {list.items.length === 0 && <p className="muted">No contacts yet.</p>}
    </>
  );
}
