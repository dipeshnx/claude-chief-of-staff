import type { ChatEvent } from '../../../shared/types';

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: { content: string; isError: boolean } }
  | { kind: 'turn'; costUsd: number | null; durationMs: number | null }
  | { kind: 'error'; message: string; stderr: string[] };

export interface ChatView { items: ChatItem[]; running: boolean; resumed: boolean }

export const emptyChat: ChatView = { items: [], running: false, resumed: false };

export function applyEvent(chat: ChatView, ev: ChatEvent): ChatView {
  const push = (item: ChatItem) => ({ ...chat, items: [...chat.items, item] });
  switch (ev.type) {
    case 'user':
      return push({ kind: 'user', text: ev.text });
    case 'text_delta':
    case 'text': {
      const last = chat.items.at(-1);
      if (last?.kind === 'assistant') return { ...chat, items: [...chat.items.slice(0, -1), { kind: 'assistant', text: last.text + ev.text }] };
      return push({ kind: 'assistant', text: ev.text });
    }
    case 'tool_use':
      return push({ kind: 'tool', id: ev.id, name: ev.name, input: ev.input });
    case 'tool_result':
      return {
        ...chat,
        items: chat.items.map((it) => (it.kind === 'tool' && it.id === ev.toolUseId ? { ...it, result: { content: ev.content, isError: ev.isError } } : it)),
      };
    case 'turn_result':
      return push({ kind: 'turn', costUsd: ev.costUsd, durationMs: ev.durationMs });
    case 'status':
      return { ...chat, running: ev.state === 'running' };
    case 'error':
      return { ...push({ kind: 'error', message: ev.message, stderr: ev.stderr }), running: false };
    case 'session':
      return chat;
  }
}

export function fromHistory(events: ChatEvent[], running: boolean, resumed: boolean): ChatView {
  return { ...events.reduce(applyEvent, emptyChat), running, resumed };
}
