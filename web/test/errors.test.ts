import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { sendError } from '../server/routes/errors';

function fakeReply() {
  const out: { status?: number; body?: unknown } = {};
  const reply = {
    code(n: number) { out.status = n; return reply; },
    send(b: unknown) { out.body = b; return reply; },
  };
  return { reply: reply as unknown as FastifyReply, out };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('sendError', () => {
  it('hides internal error details from the client and logs them', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reply, out } = fakeReply();
    const err = new Error('EACCES: permission denied, open /Users/x/.claude/secret');
    sendError(reply, err);
    expect(out).toEqual({ status: 500, body: { error: 'internal', message: 'Internal server error' } });
    expect(log).toHaveBeenCalledWith(expect.any(String), err);
  });

  it('keeps 4xx messages', () => {
    const { reply, out } = fakeReply();
    sendError(reply, Object.assign(new Error('Body is not valid JSON'), { statusCode: 400 }));
    expect(out).toEqual({ status: 400, body: { error: 'bad_request', message: 'Body is not valid JSON' } });
  });
});
