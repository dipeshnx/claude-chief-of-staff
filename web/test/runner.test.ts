import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeRunner, newChatId } from '../server/claude/runner';
import { SessionIndex } from '../server/claude/sessions';
import { TranscriptStore } from '../server/claude/transcripts';
import { ApprovalBroker } from '../server/mcp/approvals';
import type { ChatEvent } from '../shared/types';
import { FAKE_CLAUDE, waitFor } from './helpers';

const runners: ClaudeRunner[] = [];
afterEach(async () => { await Promise.all(runners.splice(0).map((r) => r.shutdown())); });

async function setup(claudeBin = FAKE_CLAUDE) {
  const dir = await mkdtemp(join(tmpdir(), 'cos-run-'));
  const log = join(dir, 'fake.log');
  const sessions = new SessionIndex(join(dir, 'sessions.json'));
  const runner = new ClaudeRunner(
    { claudeBin, cwd: dir, approvalTimeoutMs: 60_000, mcpUrl: (id) => `http://127.0.0.1:1/mcp?chat=${id}`, env: { ...process.env, FAKE_LOG: log } },
    sessions,
    new ApprovalBroker(60_000),
  );
  runners.push(runner);
  const events: [string, ChatEvent][] = [];
  runner.on('event', (id: string, ev: ChatEvent) => events.push([id, ev]));
  const of = (id: string) => events.filter(([c]) => c === id).map(([, e]) => e);
  const text = (id: string) => of(id).filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('');
  const results = (id: string) => of(id).filter((e) => e.type === 'turn_result').length;
  const logLines = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { runner, sessions, of, text, results, logLines };
}

describe('ClaudeRunner', () => {
  it('streams a reply and records the session', async () => {
    const { runner, sessions, of, text, results } = await setup();
    const id = newChatId();
    await runner.send(id, 'hello');
    await waitFor(() => results(id) === 1);
    expect(text(id)).toBe('echo: hello');
    expect(of(id).map((e) => e.type)).toEqual(expect.arrayContaining(['user', 'status', 'session', 'turn_result']));
    await waitFor(() => of(id).at(-1)?.type === 'status');
    expect(runner.isRunning(id)).toBe(false);
    const rec = await waitFor(async () => (await sessions.get(id))?.sessionId ? sessions.get(id) : undefined);
    expect(rec).toMatchObject({ title: 'hello', sessionId: expect.stringMatching(/^fake-\d+$/) });
    expect(runner.history(id).filter((e) => e.type === 'text_delta')).toEqual([{ type: 'text_delta', text: 'echo: hello' }]);
  });

  it('logs, rather than throws, when the session index update fails', async () => {
    const { runner, sessions, results } = await setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const id = newChatId();
      await runner.send(id, 'hello');
      sessions.get = () => Promise.reject(new Error('disk gone'));
      await waitFor(() => results(id) === 1);
      await waitFor(() => log.mock.calls.some((c) => String(c[0]).includes('session index update failed')) || undefined);
    } finally {
      log.mockRestore();
    }
  });

  it('queues a second message on the same process, in order', async () => {
    const { runner, text, results, logLines } = await setup();
    const id = newChatId();
    void runner.send(id, 'one');
    void runner.send(id, 'two');
    await waitFor(() => results(id) === 2);
    expect(text(id)).toBe('echo: oneecho: two');
    expect(await logLines()).toHaveLength(1);
  });

  it('passes the approval MCP config and never --strict-mcp-config', async () => {
    const { runner, results, logLines } = await setup();
    const id = newChatId();
    await runner.send(id, 'x');
    await waitFor(() => results(id) === 1);
    const [{ args, mcpConfig }] = await logLines();
    expect(args).toEqual(expect.arrayContaining(['--permission-prompt-tool', 'mcp__cos_ui__approve', '--include-partial-messages']));
    expect(args).not.toContain('--strict-mcp-config');
    expect(mcpConfig).toEqual({ mcpServers: { cos_ui: { type: 'http', url: `http://127.0.0.1:1/mcp?chat=${id}` } } });
  });

  it('stops without an error and resumes the same session on the next send', async () => {
    const { runner, of, results, logLines } = await setup();
    const id = newChatId();
    await runner.send(id, 'hang');
    const session = await waitFor(() => of(id).find((e) => e.type === 'session') as { sessionId: string } | undefined);
    runner.stop(id);
    await waitFor(() => results(id) === 1); // the interrupted turn's result still lands
    await runner.send(id, 'after'); // waits for the stopped process to exit, then resumes
    await waitFor(() => results(id) === 2);
    expect(of(id).some((e) => e.type === 'error')).toBe(false);
    const lines = await logLines();
    expect(lines).toHaveLength(2);
    expect(lines[1].args.slice(-2)).toEqual(['--resume', session.sessionId]);
  });

  it('surfaces a crash with stderr', async () => {
    const { runner, of } = await setup();
    const id = newChatId();
    await runner.send(id, 'crash');
    const err = await waitFor(() => of(id).find((e) => e.type === 'error') as { message: string; stderr: string[] } | undefined);
    expect(err.message).toBe('Claude exited unexpectedly (code 3).');
    expect(err.stderr).toContain('boom: fatal');
    await waitFor(() => of(id).at(-1)?.type === 'status');
  });

  it('explains a missing binary', async () => {
    const { runner, of } = await setup('/nonexistent/claude');
    const id = newChatId();
    await runner.send(id, 'hi');
    const err = await waitFor(() => of(id).find((e) => e.type === 'error') as { message: string } | undefined);
    expect(err.message).toMatch(/not found/);
  });
});

describe('ClaudeRunner transcript persistence', () => {
  async function makeRunner(dir: string) {
    const runner = new ClaudeRunner(
      { claudeBin: FAKE_CLAUDE, cwd: dir, approvalTimeoutMs: 60_000, mcpUrl: (id) => `http://127.0.0.1:1/mcp?chat=${id}` },
      new SessionIndex(join(dir, 'sessions.json')),
      new ApprovalBroker(60_000),
      new TranscriptStore(join(dir, 'transcripts')),
    );
    runners.push(runner);
    let results = 0;
    runner.on('event', (_id: string, ev: ChatEvent) => { if (ev.type === 'turn_result') results += 1; });
    return { runner, results: () => results };
  }
  const userTexts = (evs: ChatEvent[]) => evs.filter((e) => e.type === 'user').map((e) => (e as { text: string }).text);
  const replyText = (evs: ChatEvent[]) => evs.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('');

  it('redraws a chat after a restart, and keeps earlier messages when it continues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cos-persist-'));
    const id = newChatId();

    const first = await makeRunner(dir);
    await first.runner.send(id, 'hello');
    await waitFor(() => first.results() === 1);
    await first.runner.shutdown();
    await waitFor(async () => (await readFile(join(dir, 'transcripts', `${id}.json`), 'utf8').catch(() => '')).includes('echo: hello') || undefined);

    // "Restart": a fresh runner with empty memory, same store.
    const second = await makeRunner(dir);
    const restored = await second.runner.loadHistory(id);
    expect(userTexts(restored)).toEqual(['hello']);
    expect(replyText(restored)).toBe('echo: hello');

    await second.runner.send(id, 'again');
    await waitFor(() => second.results() === 1);
    await waitFor(async () => (await readFile(join(dir, 'transcripts', `${id}.json`), 'utf8').catch(() => '')).includes('echo: again') || undefined);
    const saved = JSON.parse(await readFile(join(dir, 'transcripts', `${id}.json`), 'utf8')) as ChatEvent[];
    expect(userTexts(saved)).toEqual(['hello', 'again']);
  });

  it('loadHistory returns [] for an unknown chat', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cos-persist-'));
    const { runner } = await makeRunner(dir);
    expect(await runner.loadHistory('never-seen')).toEqual([]);
  });
});
