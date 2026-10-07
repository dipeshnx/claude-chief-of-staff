import { APPROVE_TOOL } from '../mcp/server';

// Vars the parent Claude Code session injects; a child CLI must not think it is a sub-session.
// Adjust to the exact set recorded in the spike findings (Task 1, check g).
const INHERITED_SESSION_VARS = /^(CLAUDECODE|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|ENTRYPOINT|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SESSION_ATTENDED))$/;

export function childEnv(env: NodeJS.ProcessEnv, approvalTimeoutMs: number): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) if (!INHERITED_SESSION_VARS.test(key)) out[key] = value;
  out.MCP_TOOL_TIMEOUT = String(approvalTimeoutMs + 60_000);
  return out;
}

export function buildArgs(mcpConfigPath: string, resumeSessionId: string | null): string[] {
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--mcp-config', mcpConfigPath, '--permission-prompt-tool', APPROVE_TOOL,
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  return args;
}

export function describeExit(code: number | null, signal: string | null, stderr: string[]): string {
  const text = stderr.join('\n');
  if (/ENOENT/.test(text)) return 'Claude CLI not found. Install Claude Code or set CLAUDE_BIN, then press Resume.';
  if (/not logged in|\/login|invalid api key|authenticat|oauth/i.test(text))
    return 'Claude CLI is not logged in. Run `claude` in a terminal once to log in, then press Resume.';
  return `Claude exited unexpectedly (${signal ?? `code ${code}`}).`;
}
