import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionIndex, titleFrom } from '../server/claude/sessions';

const file = async () => join(await mkdtemp(join(tmpdir(), 'cos-sess-')), 'cos-web', 'sessions.json');
const rec = (id: string, lastUsedAt: string) => ({ id, sessionId: null, title: id, createdAt: lastUsedAt, lastUsedAt });

describe('SessionIndex', () => {
  it('is empty when the file is missing or corrupt', async () => {
    const f = await file();
    expect(await new SessionIndex(f).list()).toEqual([]);
    await mkdir(join(f, '..'), { recursive: true });
    await writeFile(f, '{not json');
    expect(await new SessionIndex(f).list()).toEqual([]);
  });

  it('skips malformed records instead of throwing', async () => {
    const f = await file();
    await mkdir(join(f, '..'), { recursive: true });
    await writeFile(f, '[{"id":"x"}]');
    expect(await new SessionIndex(f).list()).toEqual([]);
    await writeFile(f, JSON.stringify([null, 3, 'a', { id: 1, lastUsedAt: 'z' }, rec('ok', '2026-10-01T00:00:00Z')]));
    expect((await new SessionIndex(f).list()).map((r) => r.id)).toEqual(['ok']);
  });

  it('upserts and lists newest first', async () => {
    const idx = new SessionIndex(await file());
    await idx.upsert(rec('a', '2026-10-01T00:00:00Z'));
    await idx.upsert(rec('b', '2026-10-02T00:00:00Z'));
    await idx.upsert({ ...rec('a', '2026-10-03T00:00:00Z'), sessionId: 's-a' });
    expect((await idx.list()).map((r) => r.id)).toEqual(['a', 'b']);
    expect((await idx.get('a'))?.sessionId).toBe('s-a');
    expect(await idx.get('zzz')).toBeNull();
  });

  it('does not lose concurrent upserts', async () => {
    const idx = new SessionIndex(await file());
    await Promise.all(['1', '2', '3', '4', '5'].map((id) => idx.upsert(rec(id, `2026-10-0${id}T00:00:00Z`))));
    expect((await idx.list()).map((r) => r.id).sort()).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('titleFrom', () => {
  it('collapses whitespace and truncates to 60 chars', () => {
    expect(titleFrom('  /gm  ')).toBe('/gm');
    expect(titleFrom('a\n\nb')).toBe('a b');
    expect(titleFrom('x'.repeat(80))).toBe(`${'x'.repeat(57)}...`);
    expect(titleFrom('   ')).toBe('New chat');
  });
});
