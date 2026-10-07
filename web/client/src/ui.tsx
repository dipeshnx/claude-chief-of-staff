import { ApiError } from './api';
import { useChat } from './chat/ChatContext';
import type { VersionedResource } from './useVersioned';

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.body.issues?.length) return `Check these fields: ${e.body.issues.map((i) => `${i.path || 'value'} (${i.message})`).join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Loading / parse-error / missing / conflict / save-error banners for a file-backed view. */
export function FileStatus({ res, file, onReload }: { res: VersionedResource<unknown>; file: string; onReload?: () => void }) {
  const chat = useChat();
  if (res.loading && !res.data) return <p className="muted">Loading…</p>;
  const err = res.loadError;
  return (
    <>
      {err?.status === 422 && (
        <div className="banner error">
          <p><code>{file}</code> has a syntax error{err.body.line ? ` on line ${err.body.line}` : ''}: {err.message}</p>
          <p>The UI won't edit this file until it parses.</p>
          <button onClick={() => chat.send(`Fix the YAML syntax error in ~/.claude/${file}${err.body.line ? ` (line ${err.body.line})` : ''}: ${err.message}. Keep every comment.`)}>
            Ask Claude to fix
          </button>
        </div>
      )}
      {err?.status === 404 && <div className="banner warn"><code>~/.claude/{file}</code> doesn't exist yet. Run <code>./install.sh</code> from the repo root.</div>}
      {err && err.status !== 422 && err.status !== 404 && <div className="banner error">{errorText(err)}</div>}
      {res.conflict && (
        <div className="banner warn">
          This file changed outside the UI (probably Claude) after you started editing. Reload to see the latest. Your unsaved edit will be discarded.
          <button onClick={() => { onReload?.(); void res.reload(); }}>Reload</button>
        </div>
      )}
      {res.saveError != null && <div className="banner error">{errorText(res.saveError)}</div>}
    </>
  );
}
