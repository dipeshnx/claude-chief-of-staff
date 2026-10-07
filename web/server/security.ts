import { timingSafeEqual } from 'node:crypto';

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true; // the claude CLI (MCP client) sends no Origin
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function tokenMatches(provided: string | undefined, token: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractToken(headers: Record<string, string | string[] | undefined>, url: string): string | undefined {
  const header = headers['x-cos-token'];
  if (typeof header === 'string') return header;
  try {
    return new URL(url, 'http://local').searchParams.get('t') ?? undefined;
  } catch {
    return undefined;
  }
}

/** The decoded pathname of a request URL, or null if it can't be parsed or percent-decoded. Never throws. */
export function decodedPath(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url, 'http://local').pathname);
  } catch {
    return null;
  }
}

/** Whether a URL addresses the API, WebSocket or MCP endpoint once decoded. Undecodable URLs count as protected. */
export function requiresToken(url: string): boolean {
  const path = decodedPath(url);
  if (path === null) return true;
  return path.startsWith('/api/') || path === '/api' || path === '/ws' || path.startsWith('/ws/') || path === '/mcp' || path.startsWith('/mcp/');
}

export const STATIC_WILDCARD_ROUTE = '/*';

/**
 * Default-deny: every request needs the token except a GET/HEAD that is answered by the static file handler
 * or the not-found (SPA) fallback. Decided from the matched route, not the raw URL, so encoding can't dodge it.
 */
export function routeNeedsToken(method: string, routeUrl: string | undefined): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  return !(routeUrl === undefined || routeUrl === STATIC_WILDCARD_ROUTE);
}
