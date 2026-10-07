import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptStore } from '../server/claude/transcripts';
import type { ChatEvent } from '../shared/types';

const events: ChatEvent[] = [
  { type: 'user', text: '/gm' },
  { type: 'text_delta', text: 'CALENDAR\n- 9:00 standup' },
  { type: 'turn_result', sessionId: 's1', costUsd: 0.1, durationMs: 900, isError: false },
];
const dir = async () => join(await mkdtemp(join(tmpdir(), 'cos-tx-')), 'cos-web', 'transcripts');

describe('TranscriptStore', () => {
  it('round-trips a transcript', async () => {
    const store = new TranscriptStore(await dir());
    await store.save('chat-1', events);
    expect(await store.load('chat-1')).toEqual(events);
  });

  it('returns null for a chat with no saved transcript or a corrupt file', async () => {
    const d = await dir();
    const store = new TranscriptStore(d);
    expect(await store.load('nope')).toBeNull();
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'bad.json'), '{not json');
    expect(await store.load('bad')).toBeNull();
    await writeFile(join(d, 'obj.json'), '{"a":1}');
    expect(await store.load('obj')).toBeNull();
  });

  it('refuses unsafe chat ids (they come from the browser)', async () => {
    const d = await dir();
    const store = new TranscriptStore(d);
    for (const id of ['../escape', 'a/b', '', '.hidden', 'x'.repeat(65)]) {
      await store.save(id, events);
      expect(await store.load(id)).toBeNull();
    }
    expect(await readdir(d).catch(() => [])).toEqual([]);
  });

  it('keeps transcripts private to the owner', async () => {
    const d = await dir();
    const store = new TranscriptStore(d);
    await store.save('chat-1', events);
    expect((await stat(join(d, 'chat-1.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(d)).mode & 0o777).toBe(0o700);
  });

  it('applies concurrent saves in order', async () => {
    const store = new TranscriptStore(await dir());
    await Promise.all([store.save('c', events.slice(0, 1)), store.save('c', events.slice(0, 2)), store.save('c', events)]);
    expect(await store.load('c')).toEqual(events);
  });
});
