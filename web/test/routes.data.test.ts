import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as http from 'node:http';
import { buildApp, type AppContext } from '../server/app';
import { makeHome, testConfig } from './helpers';

let ctx: AppContext | null = null;
afterEach(async () => { await ctx?.close(); ctx = null; });

async function setup() {
  const home = await makeHome();
  ctx = await buildApp(testConfig(home));
  const headers = { host: '127.0.0.1:4317', 'x-cos-token': 'test-token' };
  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    ctx!.app.inject({ method, url, payload: payload as object | undefined, headers: { ...headers, ...extra } });
  return { home, call };
}

async function rawRequest(ctx: AppContext, path: string): Promise<{ statusCode?: number; body: string }> {
  if (!ctx.app.server.listening) {
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  }
  const port = ctx.port();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { host: `127.0.0.1:${port}`, 'x-cos-token': 'test-token' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('security hook', () => {
  it('requires the token for /api', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/tasks', undefined, { 'x-cos-token': 'wrong' })).statusCode).toBe(401);
  });
  it('rejects foreign Host and Origin', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/tasks', undefined, { host: 'evil.com' })).statusCode).toBe(403);
    expect((await call('GET', '/api/tasks', undefined, { origin: 'http://evil.com' })).statusCode).toBe(403);
  });
});

describe('tasks routes', () => {
  it('creates, conflicts on stale hash, validates', async () => {
    const { call } = await setup();
    const first = (await call('GET', '/api/tasks')).json();
    expect(first.data.tasks).toEqual([]);

    const created = await call('POST', '/api/tasks', { task: { title: 'Ship web UI' }, hash: first.hash });
    expect(created.statusCode).toBe(200);
    expect(created.json().task.id).toBe('task-001');

    const stale = await call('POST', '/api/tasks', { task: { title: 'Again' }, hash: first.hash });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('conflict');

    const bad = await call('POST', '/api/tasks', { task: { title: 'x', priority: 9 }, hash: created.json().hash });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues[0].path).toBe('priority');

    const del = await call('DELETE', `/api/tasks/task-001?hash=${created.json().hash}`);
    expect(del.statusCode).toBe(200);
    expect((await call('DELETE', `/api/tasks/task-404?hash=${del.json().hash}`)).statusCode).toBe(404);
  });

  it('returns 422 with a line number for malformed YAML and never overwrites it', async () => {
    const { home, call } = await setup();
    await writeFile(join(home, 'goals.yaml'), 'objectives:\n  - name: "broken\n');
    const res = await call('GET', '/api/goals');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'parse' });
    expect(res.json().line).toBeGreaterThanOrEqual(2);
    expect((await call('PUT', '/api/goals', { data: { objectives: [] }, hash: 'x' })).statusCode).toBe(422);
  });

  it('404s on a missing data file', async () => {
    const { home, call } = await setup();
    const { rm } = await import('node:fs/promises');
    await rm(join(home, 'schedules.yaml'));
    expect((await call('GET', '/api/schedules')).statusCode).toBe(404);
  });

  it('400s on a PUT without a hash', async () => {
    const { call } = await setup();
    expect((await call('PUT', '/api/tasks', { data: { tasks: [] } })).statusCode).toBe(400);
  });
});

describe('contacts routes', () => {
  it('lists, creates (201 then 409), reads, and rejects bad slugs', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/contacts')).json().map((c: { slug: string }) => c.slug)).toEqual(['example-contact']);
    const created = await call('POST', '/api/contacts', { name: 'Pat Rivera' });
    expect(created.statusCode).toBe(201);
    expect(created.json().slug).toBe('pat-rivera');
    expect((await call('POST', '/api/contacts', { name: 'pat rivera' })).json().error).toBe('exists');
    const got = (await call('GET', '/api/contacts/pat-rivera')).json();
    expect(got.data.title).toBe('Contact: Pat Rivera');
    expect((await call('GET', '/api/contacts/bad.slug')).statusCode).toBe(400);
    const trav = await call('GET', '/api/contacts/%2E%2E');
    expect([400, 404]).toContain(trav.statusCode);
    expect(trav.json().data).toBeUndefined();
  });

  it('rejects path traversal over real socket', async () => {
    const home = await makeHome();
    const appCtx = await buildApp(testConfig(home));
    try {
      const res1 = await rawRequest(appCtx, '/api/contacts/%2E%2E');
      expect(res1.statusCode).toBe(400);
      expect(JSON.parse(res1.body).error).toBe('invalid_slug');

      const res2 = await rawRequest(appCtx, '/api/contacts/..%2Ftasks');
      expect(res2.statusCode).toBe(400);
      expect(JSON.parse(res2.body).error).toBe('invalid_slug');
    } finally {
      await appCtx.close();
    }
  });
});
