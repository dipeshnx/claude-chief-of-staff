const TOKEN_KEY = 'cos-token';

/** Move ?t=<token> from the URL into sessionStorage so it isn't left in history or bookmarks. */
export function initToken(): void {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('t');
  if (!t) return;
  sessionStorage.setItem(TOKEN_KEY, t);
  url.searchParams.delete('t');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export const token = (): string => sessionStorage.getItem(TOKEN_KEY) ?? '';

export interface ApiErrorBody { error?: string; message?: string; line?: number | null; issues?: { path: string; message: string }[] }

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: ApiErrorBody) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

export async function api<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-cos-token': token(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as T;
}
