import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Health } from '../../shared/types';
import type { CosPaths } from '../data/paths';

const exists = (p: string) => access(p).then(() => true, () => false);

export async function checkHealth(claudeBin: string, paths: CosPaths): Promise<Health> {
  let claude: Health['claude'];
  try {
    const { stdout } = await promisify(execFile)(claudeBin, ['--version'], { timeout: 10_000 });
    claude = { found: true, version: stdout.trim(), error: null };
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    claude = {
      found: !missing,
      version: null,
      error: missing ? `Claude CLI not found ("${claudeBin}"). Install Claude Code or set CLAUDE_BIN.` : (err as Error).message,
    };
  }
  const [goals, tasks, schedules, contacts] = await Promise.all([paths.goals, paths.tasks, paths.schedules, paths.contactsDir].map(exists));
  return { claude, files: { goals, tasks, schedules, contacts } };
}
