import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../server/mcp/approvals';
import type { ApprovalRequest } from '../shared/types';

describe('ApprovalBroker', () => {
  it('emits a request and resolves allow with the original input', async () => {
    const broker = new ApprovalBroker(60_000);
    const seen: ApprovalRequest[] = [];
    broker.on('request', (r: ApprovalRequest) => seen.push(r));
    const p = broker.request('c1', 'Write', { file_path: '/x' }, 'tu_1');
    expect(seen[0]).toMatchObject({ chatId: 'c1', toolName: 'Write', input: { file_path: '/x' }, toolUseId: 'tu_1' });
    expect(broker.pending()).toHaveLength(1);
    expect(broker.decide(seen[0].id, true)).toBe(true);
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { file_path: '/x' } });
    expect(broker.pending()).toEqual([]);
    expect(broker.decide(seen[0].id, true)).toBe(false);
  });

  it('denies with default or custom message', async () => {
    const broker = new ApprovalBroker(60_000);
    const a = broker.request('c1', 'Bash', {});
    broker.decide(broker.pending()[0].id, false);
    expect(await a).toEqual({ behavior: 'deny', message: 'User denied in web UI' });
    const b = broker.request('c1', 'Bash', {});
    broker.decide(broker.pending()[0].id, false, '  not now  ');
    expect(await b).toEqual({ behavior: 'deny', message: 'not now' });
  });

  it('auto-denies after the timeout and emits resolved', async () => {
    const broker = new ApprovalBroker(30);
    const resolved: string[] = [];
    broker.on('resolved', (id: string) => resolved.push(id));
    expect(await broker.request('c1', 'Write', {})).toEqual({ behavior: 'deny', message: 'No response from user' });
    expect(resolved).toHaveLength(1);
  });

  it('cancels all pending requests for one chat only', async () => {
    const broker = new ApprovalBroker(60_000);
    const a = broker.request('c1', 'Write', {});
    broker.request('c2', 'Write', {});
    broker.cancelChat('c1', 'Claude process exited');
    expect(await a).toEqual({ behavior: 'deny', message: 'Claude process exited' });
    expect(broker.pending().map((r) => r.chatId)).toEqual(['c2']);
  });

  it('denies when the caller aborts', async () => {
    const broker = new ApprovalBroker(60_000);
    const ac = new AbortController();
    const p = broker.request('c1', 'Write', {}, undefined, ac.signal);
    ac.abort();
    expect(await p).toEqual({ behavior: 'deny', message: 'Request cancelled' });
  });
});
