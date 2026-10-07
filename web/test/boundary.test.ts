import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';
import WebSocket from 'ws';
import { buildApp, type AppContext } from '../server/app';
import { makeHome, testConfig } from './helpers';

// Real-socket tests of the single network boundary: raw (un-normalised) paths go straight to the server.

const HAS_CLIENT = existsSync(fileURLToPath(new URL('../dist/client/index.html', import.meta.url)));

let ctx: AppContext | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await ctx?.close();
  ctx = null;
});

async function start() {
  const home = await makeHome();
  ctx = await buildApp(testConfig(home, { port: 0 }));
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  return ctx.port();
}

interface RawRes { status: number; headers: http.IncomingHttpHeaders; body: string }

function raw(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<RawRes> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function wsStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    sockets.push(ws);
    ws.once('open', () => resolve(101));
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('error', reject);
  });
}

const MCP_INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
});
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('token boundary with encoded paths', () => {
  it('rejects a percent-encoded /api path without the token', async () => {
    const port = await start();
    const res = await raw(port, 'GET', '/%61pi/tasks');
    expect(res.status).toBe(401);
    expect(res.body).not.toContain('tasks"');
  });

  it('never serves data for /api%2Ftasks without the token', async () => {
    const port = await start();
    const res = await raw(port, 'GET', '/api%2Ftasks');
    expect([401, 404]).toContain(res.status);
    expect(res.body).not.toContain('"hash"');
  });

  it('rejects a percent-encoded /mcp path without the token', async () => {
    const port = await start();
    const res = await raw(port, 'POST', '/%6Dcp?chat=x', { headers: MCP_HEADERS, body: MCP_INIT });
    expect(res.status).toBe(401);
  });

  it('still accepts /mcp with the token', async () => {
    const port = await start();
    const res = await raw(port, 'POST', '/mcp?chat=x&t=test-token', { headers: MCP_HEADERS, body: MCP_INIT });
    expect(res.status).toBe(200);
  });

  it('rejects unknown non-GET methods without the token', async () => {
    const port = await start();
    expect((await raw(port, 'POST', '/nothing-here')).status).toBe(401);
    expect((await raw(port, 'DELETE', '/%61pi/tasks/x')).status).toBe(401);
  });

  it('does not crash on malformed percent-encoding', async () => {
    const port = await start();
    const res = await raw(port, 'GET', '/%E0%A4%A');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const bad = await raw(port, 'GET', '/api/%E0%A4%A');
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    // and the server is still up
    expect((await raw(port, 'GET', '/api/tasks', { headers: { 'x-cos-token': 'test-token' } })).status).toBe(200);
  });
});

describe('WebSocket boundary', () => {
  it('rejects a percent-encoded /ws path without the token', async () => {
    const port = await start();
    expect(await wsStatus(port, '/%77s')).toBe(401);
  });

  it('rejects /ws with no t param at all', async () => {
    const port = await start();
    expect(await wsStatus(port, '/ws')).toBe(401);
  });

  it('rejects /ws with a bad Host header', async () => {
    const port = await start();
    expect(await wsStatus(port, '/ws?t=test-token', { host: 'evil.com' })).toBe(403);
  });

  it('accepts /ws with the token', async () => {
    const port = await start();
    expect(await wsStatus(port, '/ws?t=test-token')).toBe(101);
  });
});

describe.skipIf(!HAS_CLIENT)('static SPA without a token (needs npm run build)', () => {
  it('serves index.html, assets and the SPA fallback', async () => {
    const port = await start();
    const index = await raw(port, 'GET', '/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    const asset = index.body.match(/\/assets\/[^"]+\.js/)?.[0];
    expect(asset).toBeTruthy();
    expect((await raw(port, 'GET', asset!)).status).toBe(200);
    expect((await raw(port, 'HEAD', asset!)).status).toBe(200);
    const spa = await raw(port, 'GET', '/tasks');
    expect(spa.status).toBe(200);
    expect(spa.headers['content-type']).toContain('text/html');
  });

  it('does not serve the SPA for protected paths, however encoded', async () => {
    const port = await start();
    for (const p of ['/api/nope', '/%61pi/nope', '/api%2Fnope', '/ws/x', '/mcp/x', '/%6Dcp/x']) {
      const res = await raw(port, 'GET', p);
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.headers['content-type'] ?? '', p).not.toContain('text/html');
    }
  });
});

describe('framing headers', () => {
  it('forbids framing on every response', async () => {
    const port = await start();
    for (const res of [await raw(port, 'GET', '/'), await raw(port, 'GET', '/api/tasks')]) {
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    }
  });
});
