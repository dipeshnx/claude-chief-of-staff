import { watch, type FSWatcher } from 'chokidar';
import { basename, dirname } from 'node:path';
import type { FileKind } from '../../shared/types';
import { TMP_PREFIX } from './files';
import type { CosPaths } from './paths';

export function watchCosFiles(paths: CosPaths, onChange: (kind: FileKind, name?: string) => void): { close(): Promise<void>; watcher: FSWatcher } {
  const watcher = watch([paths.goals, paths.tasks, paths.schedules, paths.contactsDir], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    ignored: (p: string) => basename(p).startsWith(TMP_PREFIX),
  });
  const kindOf = (p: string): FileKind | null => {
    if (p === paths.goals) return 'goals';
    if (p === paths.tasks) return 'tasks';
    if (p === paths.schedules) return 'schedules';
    if (dirname(p) === paths.contactsDir && p.endsWith('.md')) return 'contacts';
    return null;
  };
  watcher.on('all', (_event, p) => {
    const kind = kindOf(p);
    if (kind) onChange(kind, kind === 'contacts' ? basename(p, '.md') : undefined);
  });
  watcher.on('error', (err) => console.error('[cos-web] file watcher error:', err));
  return { close: () => watcher.close(), watcher };
}
