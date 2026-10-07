import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config';

describe('loadConfig', () => {
  it('uses defaults', () => {
    const c = loadConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4317);
    expect(c.cosHome).toBe(join(homedir(), '.claude'));
    expect(c.cwd).toBe(homedir());
    expect(c.claudeBin).toBe('claude');
    expect(c.approvalTimeoutMs).toBe(30 * 60_000);
    expect(c.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a different token each time', () => {
    expect(loadConfig({}).token).not.toBe(loadConfig({}).token);
  });

  it('honours overrides', () => {
    const c = loadConfig({ COS_PORT: '5000', COS_TOKEN: 'abc', COS_HOME: '/h', COS_CWD: '/w', CLAUDE_BIN: '/bin/c', COS_APPROVAL_TIMEOUT_MS: '50' });
    expect(c).toMatchObject({ port: 5000, token: 'abc', cosHome: '/h', cwd: '/w', claudeBin: '/bin/c', approvalTimeoutMs: 50 });
  });

  it('accepts port 0 (tests) and rejects garbage', () => {
    expect(loadConfig({ COS_PORT: '0' }).port).toBe(0);
    expect(() => loadConfig({ COS_PORT: 'abc' })).toThrow(/COS_PORT/);
    expect(() => loadConfig({ COS_APPROVAL_TIMEOUT_MS: '-1' })).toThrow(/COS_APPROVAL_TIMEOUT_MS/);
  });
});
