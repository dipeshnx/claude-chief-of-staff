import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { buildApp, type AppContext } from '../server/app';
import type { ClientMsg, ServerMsg } from '../shared/types';
import { makeHome, testConfig, waitFor } from './helpers';

let ctx: AppContext | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await ctx?.close();
  ctx = null;
});

async function start() {
  const home = await makeHome();
  ctx = await buildApp(testConfig(home, { port: 0 }));
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  return { home, port: ctx.port() };
}

function connect(port: number, opts: { token?: string; origin?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${opts.token ?? 'test-token'}`, opts.origin ? { origin: opts.origin } : {});
  sockets.push(ws);
  const inbox: ServerMsg[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
  const next = <T extends ServerMsg['type']>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true) =>
    waitFor(() => inbox.find((m) => m.type === type && pred(m as Extract<ServerMsg, { type: T }>)) as Extract<ServerMsg, { type: T }> | undefined);
  const textOf = (chatId: string) =>
    inbox.filter((m) => m.type === 'chat.event' && m.chatId === chatId && m.event.type === 'text_delta')
      .map((m) => ((m as Extract<ServerMsg, { type: 'chat.event' }>).event as { text: string }).text).join('');
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  return { ws, inbox, opened, next, textOf, send };
}

describe('WS hub', () => {
  it('rejects missing token and foreign origin', async () => {
    const { port } = await start();
    await expect(connect(port, { token: 'nope' }).opened).rejects.toThrow('HTTP 401');
    await expect(connect(port, { origin: 'http://evil.com' }).opened).rejects.toThrow('HTTP 403');
  });

  it('creates a chat, then streams its events', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.opened;
    await c.next('approval.snapshot');
    c.send({ type: 'chat.send', text: 'hello', clientRef: 'ref-1' });
    const created = await c.next('chat.created', (m) => m.clientRef === 'ref-1');
    await c.next('chat.event', (m) => m.chatId === created.chatId && m.event.type === 'turn_result');
    expect(c.textOf(created.chatId)).toBe('echo: hello');
    const firstEventIndex = c.inbox.findIndex((m) => m.type === 'chat.event' && m.chatId === created.chatId);
    expect(c.inbox.indexOf(created)).toBeLessThan(firstEventIndex);

    c.send({ type: 'chat.open', chatId: created.chatId });
    const hist = await c.next('chat.history');
    expect(hist).toMatchObject({ chatId: created.chatId, running: false, resumed: false });
    expect(hist.events.some((e) => e.type === 'user')).toBe(true);

    const chats = await (await fetch(`http://127.0.0.1:${port}/api/chats`, { headers: { 'x-cos-token': 'test-token' } })).json();
    expect(chats[0]).toMatchObject({ id: created.chatId, title: 'hello' });
  });

  it('round-trips an approval: allow and deny-with-reason', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.opened;
    c.send({ type: 'chat.send', text: 'approve-me', clientRef: 'a' });
    const { chatId } = await c.next('chat.created');
    const req = await c.next('approval.request');
    expect(req.request).toMatchObject({ chatId, toolName: 'Write', input: { file_path: '/tmp/fake.txt', content: 'hi' } });
    c.send({ type: 'approval.decide', id: req.request.id, allow: true });
    await c.next('approval.resolved', (m) => m.id === req.request.id);
    await waitFor(() => c.textOf(chatId).includes('decision: allow') || undefined);

    c.send({ type: 'chat.send', chatId, text: 'approve-me' });
    const req2 = await c.next('approval.request', (m) => m.request.id !== req.request.id);
    c.send({ type: 'approval.decide', id: req2.request.id, allow: false, message: 'nope' });
    await waitFor(() => c.textOf(chatId).includes('decision: deny nope') || undefined);
  });

  it('re-delivers a pending approval to a reconnecting tab', async () => {
    const { port } = await start();
    const a = connect(port);
    await a.opened;
    a.send({ type: 'chat.send', text: 'approve-me', clientRef: 'r' });
    const { chatId } = await a.next('chat.created');
    const req = await a.next('approval.request');
    a.ws.close();

    const b = connect(port);
    await b.opened;
    const snap = await b.next('approval.snapshot', (m) => m.requests.length > 0);
    expect(snap.requests.map((r) => r.id)).toEqual([req.request.id]);
    b.send({ type: 'approval.decide', id: req.request.id, allow: true });
    await waitFor(() => b.textOf(chatId).includes('decision: allow') || undefined);
  });

  it('answers malformed messages with an error and keeps the socket open', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.opened;
    c.ws.send('not json');
    await c.next('error');
    c.send({ type: 'chat.send', text: 'still alive', clientRef: 'z' });
    await c.next('chat.created');
  });

  it('broadcasts file.changed when files change on disk', async () => {
    const { home, port } = await start();
    const c = connect(port);
    await c.opened;
    await new Promise((r) => setTimeout(r, 300)); // let the watcher finish its initial scan
    await writeFile(join(home, 'my-tasks.yaml'), 'tasks: []\n# changed by claude\n');
    await c.next('file.changed', (m) => m.kind === 'tasks');
    await writeFile(join(home, 'contacts', 'new-person.md'), '# Contact: New Person\n');
    await c.next('file.changed', (m) => m.kind === 'contacts' && m.name === 'new-person');
  });
});

describe('GET /api/health', () => {
  it('reports the CLI version and data files', async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'x-cos-token': 'test-token' } });
    expect(await res.json()).toEqual({
      claude: { found: true, version: '9.9.9 (Fake Claude)', error: null },
      files: { goals: true, tasks: true, schedules: true, contacts: true },
    });
  });
});

describe('chat history across a server restart', () => {
  it('reopening a chat after a restart redraws its messages', async () => {
    const home = await makeHome();
    const first = await buildApp(testConfig(home, { port: 0 }));
    await first.app.listen({ host: '127.0.0.1', port: 0 });
    const a = connect(first.port());
    await a.opened;
    a.send({ type: 'chat.send', text: 'hello', clientRef: 'r1' });
    const { chatId } = await a.next('chat.created');
    await a.next('chat.event', (m) => m.chatId === chatId && m.event.type === 'turn_result');
    a.ws.close();
    await first.close();

    ctx = await buildApp(testConfig(home, { port: 0 }));
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    const b = connect(ctx.port());
    await b.opened;
    b.send({ type: 'chat.open', chatId });
    const hist = await b.next('chat.history', (m) => m.chatId === chatId);
    expect(hist.resumed).toBe(false);
    expect(hist.events.filter((e) => e.type === 'user').map((e) => (e as { text: string }).text)).toEqual(['hello']);
    expect(hist.events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('echo: hello');
  });
});
