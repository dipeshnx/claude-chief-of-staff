import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApp, type AppContext } from '../server/app';
import type { ApprovalRequest } from '../shared/types';
import { makeHome, testConfig } from './helpers';

let ctx: AppContext | null = null;
afterEach(async () => { await ctx?.close(); ctx = null; });

async function listen() {
  ctx = await buildApp(testConfig(await makeHome(), { port: 0 }));
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  return ctx.port();
}

describe('POST /mcp approve tool', () => {
  it('blocks until the broker decides, then returns the decision as JSON text', async () => {
    const port = await listen();
    ctx!.broker.on('request', (r: ApprovalRequest) => {
      expect(r).toMatchObject({ chatId: 'chat-1', toolName: 'Write' });
      setTimeout(() => ctx!.broker.decide(r.id, true), 50);
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?t=test-token&chat=chat-1`)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['approve']);
    const res = await client.callTool({ name: 'approve', arguments: { tool_name: 'Write', input: { file_path: '/x' }, tool_use_id: 'tu' } });
    await client.close();
    const content = res.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual({ behavior: 'allow', updatedInput: { file_path: '/x' } });
  });

  it('rejects requests without the token', async () => {
    const port = await listen();
    const res = await fetch(`http://127.0.0.1:${port}/mcp?chat=x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
  });

  it('answers with an error instead of hanging on an invalid JSON-RPC body', async () => {
    const port = await listen();
    const res = await fetch(`http://127.0.0.1:${port}/mcp?t=test-token&chat=c1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('requires a chat id', async () => {
    const port = await listen();
    const res = await fetch(`http://127.0.0.1:${port}/mcp?t=test-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_chat' });
  });
});
