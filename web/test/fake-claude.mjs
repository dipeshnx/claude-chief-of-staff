#!/usr/bin/env node
// Scripted stand-in for `claude -p --input-format stream-json --output-format stream-json`.
// Messages: "crash" → stderr + exit 3; "hang" → never answers; "approve-me" → calls the approve MCP tool;
// anything else → streams "echo: <text>".
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Fake Claude)');
  process.exit(0);
}
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mcpConfigPath = arg('--mcp-config');
const mcpConfig = mcpConfigPath ? JSON.parse(readFileSync(mcpConfigPath, 'utf8')) : null;
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, mcpConfig }) + '\n');

const sessionId = arg('--resume') ?? `fake-${process.pid}`;
const out = (o) => process.stdout.write(JSON.stringify({ session_id: sessionId, ...o }) + '\n');
let inTurn = false;
// Mimic the real CLI: SIGINT mid-turn emits an error_during_execution result, then exits 0.
process.on('SIGINT', () => {
  if (inTurn) out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Interrupted' });
  process.exit(inTurn ? 0 : 130);
});
out({ type: 'system', subtype: 'init' });

async function approve() {
  const client = new Client({ name: 'fake-claude', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpConfig.mcpServers.cos_ui.url)));
  const res = await client.callTool(
    { name: 'approve', arguments: { tool_name: 'Write', input: { file_path: '/tmp/fake.txt', content: 'hi' }, tool_use_id: 'tu_fake' } },
    undefined,
    { timeout: 600_000 },
  );
  await client.close();
  return JSON.parse(res.content[0].text);
}

async function handle(text) {
  if (text === 'crash') {
    process.stderr.write('boom: fatal\n');
    process.exit(3);
  }
  if (text === 'hang') {
    inTurn = true;
    return new Promise(() => {});
  }
  let reply = `echo: ${text}`;
  if (text === 'approve-me') {
    const d = await approve();
    reply = `decision: ${d.behavior}${d.message ? ` ${d.message}` : ''}`;
  }
  out({ type: 'stream_event', event: { type: 'message_start', message: {} } });
  const mid = Math.ceil(reply.length / 2);
  for (const chunk of [reply.slice(0, mid), reply.slice(mid)]) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } } });
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } });
  out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 5, result: reply });
}

let chain = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const text = JSON.parse(line).message.content.map((c) => c.text ?? '').join('');
  chain = chain.then(() => handle(text));
});
process.stdin.on('end', () => chain.then(() => process.exit(0)));
