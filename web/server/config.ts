import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  host: '127.0.0.1';
  port: number;
  token: string;
  cosHome: string;
  cwd: string;
  claudeBin: string;
  approvalTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.COS_PORT === undefined ? 4317 : Number(env.COS_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid COS_PORT: ${env.COS_PORT}`);
  const timeout = env.COS_APPROVAL_TIMEOUT_MS === undefined ? 30 * 60_000 : Number(env.COS_APPROVAL_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`Invalid COS_APPROVAL_TIMEOUT_MS: ${env.COS_APPROVAL_TIMEOUT_MS}`);
  return {
    host: '127.0.0.1',
    port,
    token: env.COS_TOKEN || randomBytes(32).toString('hex'),
    cosHome: env.COS_HOME || join(homedir(), '.claude'),
    cwd: env.COS_CWD || homedir(),
    claudeBin: env.CLAUDE_BIN || 'claude',
    approvalTimeoutMs: timeout,
  };
}
