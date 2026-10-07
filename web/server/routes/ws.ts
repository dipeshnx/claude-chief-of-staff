import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { ChatEvent, ServerMsg } from '../../shared/types';
import { newChatId, type ClaudeRunner } from '../claude/runner';
import type { SessionIndex } from '../claude/sessions';
import type { ApprovalBroker } from '../mcp/approvals';

const ClientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.send'), chatId: z.string().min(1).optional(), text: z.string().trim().min(1), clientRef: z.string().optional() }),
  z.object({ type: z.literal('chat.stop'), chatId: z.string().min(1) }),
  z.object({ type: z.literal('chat.open'), chatId: z.string().min(1) }),
  z.object({ type: z.literal('approval.decide'), id: z.string().min(1), allow: z.boolean(), message: z.string().optional() }),
]);

interface Deps { runner: ClaudeRunner; broker: ApprovalBroker; sessions: SessionIndex }

export function registerWs(app: FastifyInstance, { runner, broker, sessions }: Deps): { broadcast(msg: ServerMsg): void } {
  const sockets = new Set<WebSocket>();
  const sendTo = (socket: WebSocket, msg: ServerMsg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMsg) => sockets.forEach((s) => sendTo(s, msg));

  runner.on('event', (chatId: string, event: ChatEvent) => broadcast({ type: 'chat.event', chatId, event }));
  runner.on('chats-changed', () => broadcast({ type: 'chats.changed' }));
  broker.on('request', (request) => broadcast({ type: 'approval.request', request }));
  broker.on('resolved', (id: string) => broadcast({ type: 'approval.resolved', id }));

  async function handle(socket: WebSocket, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return sendTo(socket, { type: 'error', message: 'Malformed message' });
    }
    const result = ClientMsgSchema.safeParse(parsed);
    if (!result.success) return sendTo(socket, { type: 'error', message: 'Malformed message' });
    const msg = result.data;
    switch (msg.type) {
      case 'chat.send': {
        const chatId = msg.chatId ?? newChatId();
        if (!msg.chatId) broadcast({ type: 'chat.created', chatId, clientRef: msg.clientRef });
        await runner.send(chatId, msg.text);
        return;
      }
      case 'chat.stop':
        return runner.stop(msg.chatId);
      case 'chat.open': {
        const events = runner.history(msg.chatId);
        const rec = await sessions.get(msg.chatId);
        return sendTo(socket, { type: 'chat.history', chatId: msg.chatId, events, running: runner.isRunning(msg.chatId), resumed: events.length === 0 && !!rec?.sessionId });
      }
      case 'approval.decide':
        broker.decide(msg.id, msg.allow, msg.message);
        return;
    }
  }

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (raw) => {
      handle(socket, raw.toString()).catch((err: Error) => sendTo(socket, { type: 'error', message: err.message }));
    });
    sendTo(socket, { type: 'approval.snapshot', requests: broker.pending() });
  });

  return { broadcast };
}
