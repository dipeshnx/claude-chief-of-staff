import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const TMP_PREFIX = '.cos-tmp-';

export class ConflictError extends Error {
  constructor(path: string) {
    super(`File changed since it was loaded: ${path}`);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'NotFoundError';
  }
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

export function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function readText(path: string): Promise<{ text: string; hash: string }> {
  try {
    const text = await readFile(path, 'utf8');
    return { text, hash: hashOf(text) };
  } catch (err) {
    if (isMissing(err)) throw new NotFoundError(path);
    throw err;
  }
}

async function currentHash(path: string): Promise<string | null> {
  try {
    return hashOf(await readFile(path, 'utf8'));
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * expectedHash: undefined = no check, null = file must not exist, string = must match current contents.
 * mode: permissions for the new file (default 0o666 minus umask).
 */
export async function writeAtomic(path: string, text: string, expectedHash?: string | null, mode?: number): Promise<string> {
  if (expectedHash !== undefined && (await currentHash(path)) !== expectedHash) throw new ConflictError(path);
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `${TMP_PREFIX}${basename(path)}-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return hashOf(text);
}

export async function removeChecked(path: string, expectedHash: string): Promise<void> {
  if ((await currentHash(path)) !== expectedHash) throw new ConflictError(path);
  await rm(path);
}
