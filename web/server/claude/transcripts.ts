import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatEvent } from '../../shared/types';
import { writeAtomic } from '../data/files';

// Chat ids arrive from the browser; only plain ids map to a file (no paths, no dotfiles).
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Saves each chat's transcript so it can be redrawn after a server restart.
 * Transcripts contain email/calendar text, so files are owner-only.
 */
export class TranscriptStore {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly dir: string) {}

  private fileFor(chatId: string): string | null {
    return SAFE_ID.test(chatId) ? join(this.dir, `${chatId}.json`) : null;
  }

  async load(chatId: string): Promise<ChatEvent[] | null> {
    const file = this.fileFor(chatId);
    if (!file) return null;
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      return Array.isArray(raw) ? (raw as ChatEvent[]) : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[cos-web] could not read transcript ${chatId}:`, err);
      return null;
    }
  }

  /** Saves are serialized per chat, so the last call always wins. */
  save(chatId: string, events: ChatEvent[]): Promise<void> {
    const file = this.fileFor(chatId);
    if (!file) return Promise.resolve();
    const snapshot = JSON.stringify(events);
    const run = (this.queues.get(chatId) ?? Promise.resolve()).then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeAtomic(file, snapshot, undefined, 0o600);
    });
    this.queues.set(chatId, run.catch(() => {}));
    return run;
  }
}
