import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { YamlParseError, loadYaml, mergeInto, saveYaml } from '../server/data/yamlStore';
import { makeHome } from './helpers';

const commentLines = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('#')).map((l) => l.trim());

describe('mergeInto + saveYaml', () => {
  it('adds the first task to the shipped `tasks: []` template, keeping every comment', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const before = await readFile(p, 'utf8');
    const { doc, hash } = await loadYaml(p);
    mergeInto(doc, ['tasks'], [{ id: 'task-001', title: 'First', status: 'pending', priority: 3 }]);
    await saveYaml(p, doc, hash);
    const after = await readFile(p, 'utf8');
    expect(parse(after).tasks).toEqual([{ id: 'task-001', title: 'First', status: 'pending', priority: 3 }]);
    expect(after).not.toContain('tasks: []');
    for (const line of commentLines(before)) expect(after).toContain(line);
  });

  it('round-trips YAML-special characters exactly', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const title = 'Q1: board update #2 "draft" — it\'s {urgent}';
    const { doc, hash } = await loadYaml(p);
    mergeInto(doc, ['tasks'], [{ id: 'task-001', title, status: 'pending', priority: 3, notes: '- not a list\n: not a key' }]);
    await saveYaml(p, doc, hash);
    const t = parse(await readFile(p, 'utf8')).tasks[0];
    expect(t.title).toBe(title);
    expect(t.notes).toBe('- not a list\n: not a key');
  });

  it('updates a scalar in goals.yaml without touching comments or unknown keys', async () => {
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    const before = await readFile(p, 'utf8');
    const { doc, hash } = await loadYaml(p);
    const data = doc.toJS();
    data.objectives[0].progress = 0.5;
    mergeInto(doc, [], data);
    await saveYaml(p, doc, hash);
    const after = await readFile(p, 'utf8');
    const parsed = parse(after);
    expect(parsed.objectives[0].progress).toBe(0.5);
    expect(parsed.personal).toEqual(parse(before).personal); // unknown top-level key survives
    for (const line of commentLines(before)) expect(after).toContain(line);
  });

  it('deletes keys absent from the new value and shrinks arrays', async () => {
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    const { doc, hash } = await loadYaml(p);
    const data = doc.toJS();
    delete data.objectives[0].notes;
    data.objectives = data.objectives.slice(0, 1);
    mergeInto(doc, [], data);
    await saveYaml(p, doc, hash);
    const parsed = parse(await readFile(p, 'utf8'));
    expect(parsed.objectives).toHaveLength(1);
    expect('notes' in parsed.objectives[0]).toBe(false);
  });
});

describe('flow sequences', () => {
  it('keeps unchanged non-empty flow lists in flow style with their trailing comment', async () => {
    const home = await makeHome();
    const p = join(home, 'flow.yaml');
    await writeFile(p, 'name: x\ntags: [a, b]   # keep\n');
    const { doc, hash } = await loadYaml(p);
    mergeInto(doc, [], { ...doc.toJS(), name: 'y' });
    await saveYaml(p, doc, hash);
    const after = await readFile(p, 'utf8');
    expect(parse(after)).toEqual({ name: 'y', tags: ['a', 'b'] });
    expect(after).toMatch(/^tags: \[ ?a, b ?\] +# keep$/m);
  });
});

describe('loadYaml', () => {
  it('reports the line of a syntax error', async () => {
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    await writeFile(p, 'objectives:\n  - name: "unterminated\n');
    const err = await loadYaml(p).catch((e) => e);
    expect(err).toBeInstanceOf(YamlParseError);
    expect(err.line).toBeGreaterThanOrEqual(2);
  });
});
