import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ZodError } from 'zod';
import { ConflictError } from '../server/data/files';
import { TaskNotFoundError, goals, nextTaskId, schedules, tasks } from '../server/data/yamlFiles';
import { makeHome } from './helpers';

afterEach(() => vi.useRealTimers());

describe('nextTaskId', () => {
  it('continues after the highest numeric id', () => {
    expect(nextTaskId([])).toBe('task-001');
    expect(nextTaskId([{ id: 'task-002' }, { id: 'task-010' }, { id: 'custom' }])).toBe('task-011');
    expect(nextTaskId([{ id: 'task-999' }])).toBe('task-1000');
  });
});

describe('tasks', () => {
  it('reads the empty template', async () => {
    const home = await makeHome();
    const r = await tasks.get(join(home, 'my-tasks.yaml'));
    expect(r.data.tasks).toEqual([]);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates with defaults, then updates and removes', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    let { hash } = await tasks.get(p);
    const created = await tasks.create(p, { title: 'Draft board update', due_date: '2026-10-10' }, hash, '2026-10-06');
    expect(created.task).toEqual({ id: 'task-001', title: 'Draft board update', due_date: '2026-10-10', status: 'pending', priority: 3, created: '2026-10-06' });

    const second = await tasks.create(p, { title: 'Second' }, created.hash, '2026-10-06');
    expect(second.task.id).toBe('task-002');

    const current = await tasks.get(p);
    current.data.tasks[0].status = 'complete';
    hash = await tasks.put(p, current.data, current.hash);
    expect(parse(await readFile(p, 'utf8')).tasks[0].status).toBe('complete');

    await tasks.remove(p, 'task-001', hash);
    expect(parse(await readFile(p, 'utf8')).tasks.map((t: { id: string }) => t.id)).toEqual(['task-002']);
  });

  it('rejects invalid input and stale hashes', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const { hash } = await tasks.get(p);
    await expect(tasks.create(p, { title: '' }, hash)).rejects.toBeInstanceOf(ZodError);
    await expect(tasks.create(p, { title: 'x', priority: 9 }, hash)).rejects.toBeInstanceOf(ZodError);
    await expect(tasks.create(p, { title: 'x', due_date: 'tomorrow' }, hash)).rejects.toBeInstanceOf(ZodError);
    await writeFile(p, (await readFile(p, 'utf8')) + '\n# claude was here\n');
    await expect(tasks.create(p, { title: 'x' }, hash)).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps unknown task fields on update', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    await writeFile(p, 'tasks:\n  - id: task-001\n    title: T\n    status: pending\n    priority: 2\n    owner: sam # custom\n');
    const r = await tasks.get(p);
    r.data.tasks[0].title = 'T2';
    await tasks.put(p, r.data, r.hash);
    const text = await readFile(p, 'utf8');
    expect(text).toContain('owner: sam # custom');
    expect(parse(text).tasks[0].title).toBe('T2');
  });

  it('remove of an unknown id throws TaskNotFoundError', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const { hash } = await tasks.get(p);
    await expect(tasks.remove(p, 'task-404', hash)).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it('ignores client-provided id and created, uses server values', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    let { hash } = await tasks.get(p);
    const created = await tasks.create(p, { title: 'First' }, hash, '2026-10-06');
    hash = created.hash;
    const second = await tasks.create(
      p,
      { title: 'x', id: 'task-001', created: '1999-01-01' },
      hash,
      '2026-10-06'
    );
    expect(second.task.id).toBe('task-002');
    expect(second.task.created).toBe('2026-10-06');
    const parsed = parse(await readFile(p, 'utf8'));
    expect(parsed.tasks.map((t: { id: string }) => t.id)).toEqual(['task-001', 'task-002']);
  });

  it('rejects duplicate task ids in put', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    const r = await tasks.get(p);
    r.data.tasks = [
      { id: 'task-001', title: 'A', status: 'pending', priority: 1, created: '2026-10-06' },
      { id: 'task-001', title: 'B', status: 'pending', priority: 1, created: '2026-10-06' },
    ];
    const caught = await tasks.put(p, r.data, r.hash).catch((e) => e);
    expect(caught).toBeInstanceOf(ZodError);
    expect(String(caught.message)).toContain('Duplicate task id');
  });
});

describe('goals', () => {
  it('stamps last_updated with today on save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 12));
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    const r = await goals.get(p);
    expect(r.data.objectives).toHaveLength(3);
    r.data.objectives[1].status = 'at_risk';
    await goals.put(p, r.data, r.hash);
    const parsed = parse(await readFile(p, 'utf8'));
    expect(parsed.last_updated).toBe('2026-10-06');
    expect(parsed.objectives[1].status).toBe('at_risk');
    expect(parsed.personal).toHaveLength(2);
  });

  it('rejects progress outside 0..1', async () => {
    const home = await makeHome();
    const p = join(home, 'goals.yaml');
    const r = await goals.get(p);
    r.data.objectives[0].progress = 1.5;
    await expect(goals.put(p, r.data, r.hash)).rejects.toBeInstanceOf(ZodError);
  });
});

describe('schedules', () => {
  it('toggles enabled', async () => {
    const home = await makeHome();
    const p = join(home, 'schedules.yaml');
    const r = await schedules.get(p);
    expect(r.data.schedules[0].skill).toBe('/gm');
    r.data.schedules[0].enabled = false;
    await schedules.put(p, r.data, r.hash);
    expect(parse(await readFile(p, 'utf8')).schedules[0].enabled).toBe(false);
  });
});

describe('null optional fields', () => {
  it('saves a task file where another task has a YAML-null field, keeping the null and comments', async () => {
    const home = await makeHome();
    const p = join(home, 'my-tasks.yaml');
    await writeFile(p, [
      '# My tasks',
      'tasks:',
      '  - id: task-001',
      '    title: First',
      '    status: pending',
      '    priority: 2',
      '    notes:',
      '  # keep me',
      '  - id: task-002',
      '    title: Second',
      '    status: pending',
      '    priority: 3',
      '',
    ].join('\n'));
    const current = await tasks.get(p);
    current.data.tasks[1].status = 'complete';
    await tasks.put(p, current.data, current.hash);
    const text = await readFile(p, 'utf8');
    expect(text).toContain('# My tasks');
    expect(text).toContain('# keep me');
    const parsed = parse(text);
    expect(parsed.tasks[0]).toHaveProperty('notes', null);
    expect(parsed.tasks[1].status).toBe('complete');
  });

  it('accepts null optional fields in goals and schedules', async () => {
    const home = await makeHome();
    const g = join(home, 'goals.yaml');
    await writeFile(g, 'quarter:\nobjectives:\n  - name: Ship\n    target:\n    priority:\n    key_results:\n    progress:\n    status:\n    notes:\n');
    const goal = await goals.get(g);
    goal.data.objectives[0].name = 'Ship it';
    await goals.put(g, goal.data, goal.hash);
    expect(parse(await readFile(g, 'utf8')).objectives[0]).toMatchObject({ name: 'Ship it', target: null, notes: null });

    const s = join(home, 'schedules.yaml');
    await writeFile(s, 'schedules:\n  - name: Morning\n    skill: /gm\n    frequency:\n    enabled:\n    notes:\n');
    const sched = await schedules.get(s);
    sched.data.schedules[0].name = 'Morning brief';
    await schedules.put(s, sched.data, sched.hash);
    expect(parse(await readFile(s, 'utf8')).schedules[0]).toMatchObject({ name: 'Morning brief', frequency: null, enabled: null });
  });
});
