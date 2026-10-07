import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalRequest } from '../../shared/types';

interface Pending { request: ApprovalRequest; resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout }

/** Holds tool-permission requests from the CLI until the browser answers. Events: 'request' (ApprovalRequest), 'resolved' (id). */
export class ApprovalBroker extends EventEmitter {
  private readonly byId = new Map<string, Pending>();

  constructor(private readonly timeoutMs: number) {
    super();
  }

  request(chatId: string, toolName: string, input: Record<string, unknown>, toolUseId?: string, signal?: AbortSignal): Promise<ApprovalDecision> {
    const request: ApprovalRequest = { id: randomUUID(), chatId, toolName, input, toolUseId, createdAt: Date.now() };
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(request.id, { behavior: 'deny', message: 'No response from user' }), this.timeoutMs);
      this.byId.set(request.id, { request, resolve, timer });
      signal?.addEventListener('abort', () => this.settle(request.id, { behavior: 'deny', message: 'Request cancelled' }), { once: true });
      this.emit('request', request);
    });
  }

  decide(id: string, allow: boolean, message?: string): boolean {
    const pending = this.byId.get(id);
    if (!pending) return false;
    return this.settle(id, allow
      ? { behavior: 'allow', updatedInput: pending.request.input }
      : { behavior: 'deny', message: message?.trim() || 'User denied in web UI' });
  }

  cancelChat(chatId: string, message: string): void {
    for (const p of [...this.byId.values()]) if (p.request.chatId === chatId) this.settle(p.request.id, { behavior: 'deny', message });
  }

  pending(): ApprovalRequest[] {
    return [...this.byId.values()].map((p) => p.request);
  }

  private settle(id: string, decision: ApprovalDecision): boolean {
    const pending = this.byId.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.byId.delete(id);
    pending.resolve(decision);
    this.emit('resolved', id);
    return true;
  }
}
