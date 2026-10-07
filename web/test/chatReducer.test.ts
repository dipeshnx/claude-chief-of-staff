import { describe, expect, it } from 'vitest';
import { applyEvent, emptyChat, fromHistory } from '../client/src/chat/chatReducer';
import type { ChatEvent } from '../shared/types';

const fold = (events: ChatEvent[]) => events.reduce(applyEvent, emptyChat);

describe('chatReducer', () => {
  it('merges streamed text into one assistant bubble', () => {
    const v = fold([{ type: 'user', text: 'hi' }, { type: 'text_delta', text: 'Hel' }, { type: 'text_delta', text: 'lo' }]);
    expect(v.items).toEqual([{ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'Hello' }]);
  });

  it('attaches tool results to their tool block and starts a new bubble after a tool', () => {
    const v = fold([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } },
      { type: 'tool_result', toolUseId: 't1', content: 'data', isError: false },
      { type: 'text_delta', text: 'Done.' },
    ]);
    expect(v.items).toEqual([
      { kind: 'assistant', text: 'Checking.' },
      { kind: 'tool', id: 't1', name: 'Read', input: { file_path: '/x' }, result: { content: 'data', isError: false } },
      { kind: 'assistant', text: 'Done.' },
    ]);
  });

  it('tracks running state and records errors and turn costs', () => {
    let v = fold([{ type: 'status', state: 'running' }]);
    expect(v.running).toBe(true);
    v = applyEvent(v, { type: 'turn_result', sessionId: 's', costUsd: 0.01, durationMs: 1200, isError: false });
    v = applyEvent(v, { type: 'error', message: 'Claude exited unexpectedly (code 3).', stderr: ['boom'] });
    expect(v.running).toBe(false);
    expect(v.items.slice(-2)).toEqual([
      { kind: 'turn', costUsd: 0.01, durationMs: 1200 },
      { kind: 'error', message: 'Claude exited unexpectedly (code 3).', stderr: ['boom'] },
    ]);
    expect(applyEvent(v, { type: 'session', sessionId: 's' })).toBe(v);
  });

  it('rebuilds from history with server-reported flags', () => {
    const v = fromHistory([{ type: 'user', text: 'a' }], true, false);
    expect(v).toEqual({ items: [{ kind: 'user', text: 'a' }], running: true, resumed: false });
  });
});
