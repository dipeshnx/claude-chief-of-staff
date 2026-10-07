import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize, type StreamState } from '../server/claude/events';

const fresh = (): StreamState => ({ sawDeltas: false });

describe('normalize', () => {
  it('maps init to a session event', () => {
    expect(normalize({ type: 'system', subtype: 'init', session_id: 's1' }, fresh())).toEqual([{ type: 'session', sessionId: 's1' }]);
    expect(normalize({ type: 'system', subtype: 'other' }, fresh())).toEqual([]);
  });

  it('streams text deltas and suppresses the duplicate full text', () => {
    const s = fresh();
    expect(normalize({ type: 'stream_event', event: { type: 'message_start', message: {} } }, s)).toEqual([]);
    expect(normalize({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }, s)).toEqual([{ type: 'text_delta', text: 'Hi' }]);
    expect(normalize({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }, s)).toEqual([]);
  });

  it('uses full assistant text when no deltas were streamed', () => {
    expect(normalize({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }, fresh())).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('emits tool_use from assistant messages even after deltas', () => {
    const s = { sawDeltas: true };
    expect(normalize({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } }] } }, s))
      .toEqual([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } }]);
  });

  it('flattens and truncates tool results', () => {
    const long = 'x'.repeat(5000);
    const [ev] = normalize({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: long }, { type: 'image' }], is_error: true }] } }, fresh());
    expect(ev).toMatchObject({ type: 'tool_result', toolUseId: 'tu_1', isError: true });
    expect((ev as { content: string }).content.length).toBeLessThan(4100);
    expect((ev as { content: string }).content).toMatch(/truncated/);
    expect(normalize({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }, fresh()))
      .toEqual([{ type: 'tool_result', toolUseId: 't', content: 'ok', isError: false }]);
  });

  it('maps results, and surfaces error results', () => {
    expect(normalize({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', total_cost_usd: 0.02, duration_ms: 900 }, fresh()))
      .toEqual([{ type: 'turn_result', sessionId: 's1', costUsd: 0.02, durationMs: 900, isError: false }]);
    expect(normalize({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1', result: 'Something broke' }, fresh()))
      .toEqual([
        { type: 'error', message: 'Something broke', stderr: [] },
        { type: 'turn_result', sessionId: 's1', costUsd: null, durationMs: null, isError: true },
      ]);
  });

  it('ignores garbage', () => {
    expect(normalize(null, fresh())).toEqual([]);
    expect(normalize('text', fresh())).toEqual([]);
    expect(normalize({ type: 'unknown' }, fresh())).toEqual([]);
  });

  it('resets delta tracking across turns: turn 1 streamed, turn 2 has assistant text without stream events', () => {
    const state = fresh(); // Shared state across turns
    // Turn 1: stream events
    normalize({ type: 'stream_event', event: { type: 'message_start', message: {} } }, state);
    normalize({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Turn1' } } }, state);
    normalize({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', total_cost_usd: 0.01, duration_ms: 100 }, state);

    // Turn 2: assistant message without preceding stream_event or message_start
    // State should have sawDeltas reset by result, so this text should be emitted
    const turn2 = normalize({ type: 'assistant', message: { content: [{ type: 'text', text: 'Turn2' }] } }, state);
    expect(turn2).toEqual([{ type: 'text', text: 'Turn2' }]);
  });

  it('real fixture: concatenated deltas are one and two, exactly 2 turn_results, zero text events', () => {
    const fixtureUrl = new URL('./fixtures/real-stream.ndjson', import.meta.url);
    const lines = readFileSync(fixtureUrl, 'utf8').split('\n').filter(Boolean);

    const state = fresh(); // Shared state for entire 2-turn stream
    const allEvents: Array<{ type: string; text?: string }> = [];

    for (const line of lines) {
      const msg = JSON.parse(line);
      for (const event of normalize(msg, state)) {
        allEvents.push(event);
      }
    }

    // Count turn_results and collect text_deltas between consecutive turn_results
    const turnResults = allEvents.filter((e) => e.type === 'turn_result');
    expect(turnResults).toHaveLength(2);

    const textEvents = allEvents.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(0);

    // Collect text_deltas and verify they spell "one" then "two"
    const textDeltas = allEvents.filter((e) => e.type === 'text_delta');
    const texts: string[] = [];
    let current = '';
    for (const delta of textDeltas) {
      current += delta.text || '';
    }
    expect(current).toBe('onetwo');
  });
});
