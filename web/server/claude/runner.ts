import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChatEvent } from '../../shared/types';
import type { ApprovalBroker } from '../mcp/approvals';
import { buildArgs, childEnv, describeExit } from './env';
import { normalize, type StreamState } from './events';
import { titleFrom, type SessionIndex } from './sessions';
import type { TranscriptStore } from './transcripts';

export interface RunnerOptions {
  claudeBin: string;
  cwd: string;
  approvalTimeoutMs: number;
  mcpUrl(chatId: string): string;
  env?: NodeJS.ProcessEnv;
}

interface LiveChat {
  child: ChildProcessWithoutNullStreams;
  stderr: string[];
  stopping: boolean;
  exited: boolean;
  exitPromise: Promise<void>;
  pendingTurns: number;
  configDir: string;
  state: StreamState;
}

const MAX_TRANSCRIPT = 5000;
const STDERR_LINES = 20;

export const newChatId = (): string => randomUUID();

/** Events: 'event' (chatId, ChatEvent), 'chats-changed' (). */
export class ClaudeRunner extends EventEmitter {
  private readonly live = new Map<string, LiveChat>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly transcripts = new Map<string, ChatEvent[]>();
  private readonly sessionIds = new Map<string, string>();
  private readonly pendingSaves = new Set<Promise<void>>();

  constructor(
    private readonly opts: RunnerOptions,
    private readonly sessions: SessionIndex,
    private readonly broker: ApprovalBroker,
    private readonly store?: TranscriptStore,
  ) {
    super();
  }

  send(chatId: string, text: string): Promise<void> {
    const run = (this.queues.get(chatId) ?? Promise.resolve()).then(() => this.doSend(chatId, text));
    this.queues.set(chatId, run.catch(() => {}));
    return run;
  }

  stop(chatId: string): void {
    const chat = this.live.get(chatId);
    if (!chat || chat.stopping) return;
    chat.stopping = true;
    this.broker.cancelChat(chatId, 'Stopped by user');
    chat.child.kill('SIGINT');
    setTimeout(() => { if (!chat.exited) chat.child.kill('SIGKILL'); }, 3000).unref();
  }

  history(chatId: string): ChatEvent[] {
    return this.transcripts.get(chatId) ?? [];
  }

  /** In-memory transcript, or the saved one after a server restart. */
  async loadHistory(chatId: string): Promise<ChatEvent[]> {
    if (!this.transcripts.has(chatId) && this.store) {
      const saved = await this.store.load(chatId);
      // Re-check: a send may have started recording while the file was being read.
      if (saved && !this.transcripts.has(chatId)) this.transcripts.set(chatId, saved.slice(-MAX_TRANSCRIPT));
    }
    return this.history(chatId);
  }

  isRunning(chatId: string): boolean {
    return (this.live.get(chatId)?.pendingTurns ?? 0) > 0;
  }

  async shutdown(): Promise<void> {
    const chats = [...this.live.entries()];
    for (const [id] of chats) this.stop(id);
    await Promise.all(chats.map(([, c]) => c.exitPromise));
    await Promise.all([...this.pendingSaves]);
  }

  private async doSend(chatId: string, text: string): Promise<void> {
    // Continuing a chat after a restart must append to its saved transcript, not replace it.
    await this.loadHistory(chatId);
    const now = new Date().toISOString();
    const existing = await this.sessions.get(chatId);
    await this.sessions.upsert({
      id: chatId,
      sessionId: this.sessionIds.get(chatId) ?? existing?.sessionId ?? null,
      title: existing?.title ?? titleFrom(text),
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
    });
    this.emit('chats-changed');

    let chat = this.live.get(chatId);
    if (chat?.stopping) {
      await chat.exitPromise;
      chat = undefined;
    }
    chat ??= await this.spawnChat(chatId, this.sessionIds.get(chatId) ?? existing?.sessionId ?? null);

    this.record(chatId, { type: 'user', text });
    chat.pendingTurns += 1;
    if (chat.pendingTurns === 1) this.record(chatId, { type: 'status', state: 'running' });
    chat.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
  }

  private async spawnChat(chatId: string, resumeSessionId: string | null): Promise<LiveChat> {
    const configDir = await mkdtemp(join(tmpdir(), 'cos-web-'));
    const configPath = join(configDir, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { cos_ui: { type: 'http', url: this.opts.mcpUrl(chatId) } } }), { mode: 0o600 });

    const child = spawn(this.opts.claudeBin, buildArgs(configPath, resumeSessionId), {
      cwd: this.opts.cwd,
      env: childEnv(this.opts.env ?? process.env, this.opts.approvalTimeoutMs),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let markExited!: () => void;
    const chat: LiveChat = {
      child, stderr: [], stopping: false, exited: false, pendingTurns: 0, configDir, state: { sawDeltas: false },
      exitPromise: new Promise((r) => { markExited = r; }),
    };
    this.live.set(chatId, chat);

    const pushStderr = (line: string) => {
      chat.stderr.push(line);
      if (chat.stderr.length > STDERR_LINES) chat.stderr.shift();
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (chat.exited) return;
      chat.exited = true;
      this.onExit(chatId, chat, code, signal);
      markExited();
    };

    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(chatId, chat, line));
    createInterface({ input: child.stderr }).on('line', pushStderr);
    child.stdin.on('error', () => {}); // EPIPE when the child has already died
    child.on('error', (err) => {
      pushStderr(`spawn error: ${err.message}`);
      if (child.pid === undefined) finish(-2, null); // spawn failed; 'close' may not follow
    });
    child.on('close', finish);
    return chat;
  }

  private onLine(chatId: string, chat: LiveChat, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    let turnEnded = false;
    for (const ev of normalize(msg, chat.state)) {
      if (ev.type === 'error' && chat.stopping) continue; // a user Stop must not show an error bubble
      if (ev.type === 'session') this.rememberSession(chatId, ev.sessionId);
      this.record(chatId, ev);
      if (ev.type === 'turn_result') {
        turnEnded = true;
        if (ev.sessionId) this.rememberSession(chatId, ev.sessionId);
        chat.pendingTurns = Math.max(0, chat.pendingTurns - 1);
        if (chat.pendingTurns === 0) this.record(chatId, { type: 'status', state: 'idle' });
      }
    }
    if (turnEnded) this.persist(chatId);
  }

  private persist(chatId: string): void {
    const events = this.transcripts.get(chatId);
    if (!this.store || !events) return;
    const save = this.store.save(chatId, events)
      .catch((err) => console.error(`[cos-web] could not save transcript ${chatId}:`, err))
      .finally(() => this.pendingSaves.delete(save));
    this.pendingSaves.add(save);
  }

  private rememberSession(chatId: string, sessionId: string): void {
    if (this.sessionIds.get(chatId) === sessionId) return;
    this.sessionIds.set(chatId, sessionId);
    void (async () => {
      const rec = await this.sessions.get(chatId);
      if (rec) await this.sessions.upsert({ ...rec, sessionId });
      this.emit('chats-changed');
    })().catch((err) => console.error('[cos-web] session index update failed:', err));
  }

  private onExit(chatId: string, chat: LiveChat, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.live.get(chatId) === chat) this.live.delete(chatId);
    this.broker.cancelChat(chatId, 'Claude process exited');
    void rm(chat.configDir, { recursive: true, force: true });
    if (!chat.stopping && code !== 0) {
      this.record(chatId, { type: 'error', message: describeExit(code, signal, chat.stderr), stderr: [...chat.stderr] });
    }
    this.record(chatId, { type: 'status', state: 'idle' });
    this.persist(chatId);
  }

  private record(chatId: string, ev: ChatEvent): void {
    const list = this.transcripts.get(chatId) ?? [];
    const last = list.at(-1);
    if (ev.type === 'text_delta' && last?.type === 'text_delta') list[list.length - 1] = { type: 'text_delta', text: last.text + ev.text };
    else list.push(ev);
    if (list.length > MAX_TRANSCRIPT) list.splice(0, list.length - MAX_TRANSCRIPT);
    this.transcripts.set(chatId, list);
    this.emit('event', chatId, ev);
  }
}
