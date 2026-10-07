import { describe, expect, it } from 'vitest';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictError, NotFoundError, hashOf, readText, removeChecked, writeAtomic } from '../server/data/files';
import { InvalidSlugError, contactPath, cosPaths, slugify } from '../server/data/paths';
import { makeHome } from './helpers';

describe('writeAtomic', () => {
  it('writes when the hash matches and returns the new hash', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const { hash } = await readText(p);
    const next = await writeAtomic(p, 'tasks: []\n', hash);
    expect(next).toBe(hashOf('tasks: []\n'));
    expect(await readFile(p, 'utf8')).toBe('tasks: []\n');
  });

  it('rejects a stale hash and leaves the file alone', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const { text, hash } = await readText(p);
    await writeFile(p, text + '# edited by claude\n');
    await expect(writeAtomic(p, 'x', hash)).rejects.toBeInstanceOf(ConflictError);
    expect(await readFile(p, 'utf8')).toContain('# edited by claude');
  });

  it('null hash means create-only', async () => {
    const home = await makeHome();
    await writeAtomic(join(home, 'new.md'), 'a', null);
    await expect(writeAtomic(join(home, 'new.md'), 'b', null)).rejects.toBeInstanceOf(ConflictError);
  });

  it('leaves no temp files behind', async () => {
    const home = await makeHome();
    await writeAtomic(join(home, 'x.yaml'), 'a: 1\n');
    expect((await readdir(home)).filter((f) => f.startsWith('.cos-tmp-'))).toEqual([]);
  });
});

describe('readText / removeChecked', () => {
  it('throws NotFoundError for missing files', async () => {
    await expect(readText('/nonexistent/x.yaml')).rejects.toBeInstanceOf(NotFoundError);
  });
  it('removeChecked refuses a stale hash', async () => {
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    await expect(removeChecked(p, 'stale')).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('paths', () => {
  const paths = cosPaths('/h');
  it('lays out the known files', () => {
    expect(paths).toEqual({ home: '/h', goals: '/h/goals.yaml', tasks: '/h/my-tasks.yaml', schedules: '/h/schedules.yaml', contactsDir: '/h/contacts', sessions: '/h/cos-web/sessions.json' });
  });
  it('accepts safe slugs and rejects traversal', () => {
    expect(contactPath(paths, 'jane-smith')).toBe('/h/contacts/jane-smith.md');
    expect(contactPath(paths, 'jane_smith2')).toBe('/h/contacts/jane_smith2.md');
    for (const bad of ['../etc/passwd', '..', '.hidden', 'a/b', 'a.b', '', 'with space']) {
      expect(() => contactPath(paths, bad)).toThrow(InvalidSlugError);
    }
  });
  it('slugifies names', () => {
    expect(slugify('Jane Smith')).toBe('jane-smith');
    expect(slugify('  José Núñez ')).toBe('jose-nunez');
    expect(slugify("O'Brien, Pat")).toBe('o-brien-pat');
    expect(slugify('!!!')).toBe('');
  });
});
