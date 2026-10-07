import type { ChatEvent } from '../../shared/types';

export interface StreamState { sawDeltas: boolean }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const MAX_RESULT = 4000;

function flatten(content: unknown): string {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (isObj(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '[non-text content]')).join('\n')
      : '';
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n… (truncated)` : text;
}

export function normalize(msg: unknown, state: StreamState): ChatEvent[] {
  if (!isObj(msg)) return [];
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init' && typeof msg.session_id === 'string') {
        state.sawDeltas = false;
        return [{ type: 'session', sessionId: msg.session_id }];
      }
      return [];
    }

    case 'stream_event': {
      const ev = msg.event;
      if (!isObj(ev)) return [];
      if (ev.type === 'message_start') {
        state.sawDeltas = false;
        return [];
      }
      if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') {
        state.sawDeltas = true;
        return [{ type: 'text_delta', text: ev.delta.text }];
      }
      return [];
    }

    case 'assistant': {
      const content = isObj(msg.message) && Array.isArray(msg.message.content) ? msg.message.content : [];
      const out: ChatEvent[] = [];
      for (const block of content) {
        if (!isObj(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string' && !state.sawDeltas) out.push({ type: 'text', text: block.text });
        if (block.type === 'tool_use') out.push({ type: 'tool_use', id: String(block.id), name: String(block.name), input: block.input });
      }
      return out;
    }

    case 'user': {
      const content = isObj(msg.message) && Array.isArray(msg.message.content) ? msg.message.content : [];
      return content
        .filter((b): b is Obj => isObj(b) && b.type === 'tool_result')
        .map((b) => ({ type: 'tool_result' as const, toolUseId: String(b.tool_use_id), content: flatten(b.content), isError: b.is_error === true }));
    }

    case 'result': {
      state.sawDeltas = false;
      const out: ChatEvent[] = [];
      if (msg.is_error === true && typeof msg.result === 'string' && msg.result) out.push({ type: 'error', message: msg.result, stderr: [] });
      out.push({
        type: 'turn_result',
        sessionId: typeof msg.session_id === 'string' ? msg.session_id : null,
        costUsd: num(msg.total_cost_usd),
        durationMs: num(msg.duration_ms),
        isError: msg.is_error === true,
      });
      return out;
    }

    default:
      return [];
  }
}
