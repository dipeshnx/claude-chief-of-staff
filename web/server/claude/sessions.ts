import { readFile } from 'node:fs/promises';
import type { ChatRecord } from '../../shared/types';
import { writeAtomic } from '../data/files';

export class SessionIndex {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<ChatRecord[]> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return [];
      throw err;
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  async get(id: string): Promise<ChatRecord | null> {
    return (await this.list()).find((r) => r.id === id) ?? null;
  }

  upsert(record: ChatRecord): Promise<void> {
    const run = this.queue.then(async () => {
      const all = (await this.list()).filter((r) => r.id !== record.id);
      await writeAtomic(this.file, JSON.stringify([record, ...all], null, 2) + '\n');
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function isRecord(r: unknown): r is ChatRecord {
  return typeof r === 'object' && r !== null && typeof (r as ChatRecord).id === 'string' && typeof (r as ChatRecord).lastUsedAt === 'string';
}

export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}
