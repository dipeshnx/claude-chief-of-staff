import { cp, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../server/config';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

export async function makeHome(): Promise<string> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'cos-home-')));
  for (const f of ['goals.yaml', 'my-tasks.yaml', 'schedules.yaml']) await cp(join(REPO_ROOT, f), join(home, f));
  await mkdir(join(home, 'contacts'));
  await cp(join(REPO_ROOT, 'contacts/example-contact.md'), join(home, 'contacts/example-contact.md'));
  return home;
}

export function testConfig(home: string, overrides: Partial<Config> = {}): Config {
  return { host: '127.0.0.1', port: 4317, token: 'test-token', cosHome: home, cwd: home, claudeBin: FAKE_CLAUDE, approvalTimeoutMs: 60_000, ...overrides };
}

export async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value as T;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
