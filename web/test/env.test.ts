import { describe, expect, it } from 'vitest';
import { buildArgs, childEnv, describeExit } from '../server/claude/env';

describe('childEnv', () => {
  it('strips the parent Claude Code session vars, keeps the rest, sets MCP_TOOL_TIMEOUT', () => {
    const env = childEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_ENTRYPOINT: 'vscode', CLAUDE_CODE_USE_BEDROCK: '1' }, 60_000);
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CODE_USE_BEDROCK: '1', MCP_TOOL_TIMEOUT: '120000' });
  });
});

describe('buildArgs', () => {
  it('builds the stream-json command line', () => {
    expect(buildArgs('/tmp/m.json', null)).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--mcp-config', '/tmp/m.json', '--permission-prompt-tool', 'mcp__cos_ui__approve',
    ]);
    expect(buildArgs('/tmp/m.json', 'sess-1').slice(-2)).toEqual(['--resume', 'sess-1']);
    expect(buildArgs('/tmp/m.json', 'sess-1')).not.toContain('--strict-mcp-config');
  });
});

describe('describeExit', () => {
  it('detects missing binary and logged-out CLI', () => {
    expect(describeExit(-2, null, ['spawn claude ENOENT'])).toMatch(/not found/);
    expect(describeExit(1, null, ['Invalid API key · Please run /login'])).toMatch(/not logged in/);
    expect(describeExit(3, null, ['boom'])).toBe('Claude exited unexpectedly (code 3).');
    expect(describeExit(null, 'SIGKILL', [])).toBe('Claude exited unexpectedly (SIGKILL).');
  });
});
