import { useCallback, useEffect, useState } from 'react';
import type { FileKind, Versioned } from '../../shared/types';
import { ApiError, api } from './api';
import { useServerMessage } from './socket';

export interface VersionedResource<T> {
  data: T | null;
  hash: string | null;
  loading: boolean;
  loadError: ApiError | null;
  saveError: unknown;
  conflict: boolean;
  reload(): Promise<void>;
  save(next: T, baseHash: string): Promise<boolean>;
  run(op: () => Promise<unknown>): Promise<boolean>;
}

export function useVersioned<T>(path: string, kind: FileKind, name?: string): VersionedResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Versioned<T>>('GET', path);
      setData(r.data);
      setHash(r.hash);
      setLoadError(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, { message: String(e) });
      setLoadError(err);
      // A file that no longer parses (422) or exists (404) must not stay editable from stale data.
      if (err.status === 422 || err.status === 404) {
        setData(null);
        setHash(null);
      }
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useServerMessage((m) => {
    if (m.type === 'file.changed' && m.kind === kind && (!name || !m.name || m.name === name)) void load();
  });

  const run = useCallback(async (op: () => Promise<unknown>) => {
    setSaveError(null);
    try {
      await op();
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.error === 'conflict') setConflict(true);
      else setSaveError(e);
      return false;
    }
  }, [load]);

  const save = useCallback((next: T, baseHash: string) => run(() => api('PUT', path, { data: next, hash: baseHash })), [path, run]);

  const reload = useCallback(async () => {
    setConflict(false);
    setSaveError(null);
    await load();
  }, [load]);

  return { data, hash, loading, loadError, saveError, conflict, reload, save, run };
}

export function useList<T>(path: string, kind: FileKind): { items: T[]; error: unknown; reload(): Promise<void> } {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api<T[]>('GET', path));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useServerMessage((m) => { if (m.type === 'file.changed' && m.kind === kind) void load(); });
  return { items, error, reload: load };
}
