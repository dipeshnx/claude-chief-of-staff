import type { ZodType } from 'zod';
import type { GoalsFile, SchedulesFile, Task, TasksFile, Versioned } from '../../shared/types';
import { localToday } from '../../shared/dates';
import { loadYaml, mergeInto, saveYaml } from './yamlStore';
import { GoalsFileSchema, NewTaskSchema, SchedulesFileSchema, TasksFileSchema } from './schemas';

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`No task with id ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

function yamlResource<T extends Record<string, unknown>>(listKey: string, schema: ZodType, beforeSave: (data: T) => T = (d) => d) {
  return {
    async get(path: string): Promise<Versioned<T>> {
      const { doc, hash } = await loadYaml(path);
      const js = (doc.toJS() ?? {}) as Record<string, unknown>;
      return { data: { ...js, [listKey]: Array.isArray(js[listKey]) ? js[listKey] : [] } as T, hash };
    },
    async put(path: string, data: unknown, hash: string): Promise<string> {
      const parsed = beforeSave(schema.parse(data) as T);
      const { doc } = await loadYaml(path);
      mergeInto(doc, [], parsed);
      return saveYaml(path, doc, hash);
    },
  };
}

export function nextTaskId(list: { id: string }[]): string {
  const max = list.reduce((m, t) => {
    const n = /^task-(\d+)$/.exec(t.id)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `task-${String(max + 1).padStart(3, '0')}`;
}

const taskResource = yamlResource<TasksFile>('tasks', TasksFileSchema);

export const tasks = {
  ...taskResource,
  async create(path: string, input: unknown, hash: string, today = localToday()): Promise<{ task: Task; hash: string }> {
    const fields = NewTaskSchema.parse(input);
    const { id: _id, created: _c, ...rest } = fields;
    const { doc } = await loadYaml(path);
    const existing = ((doc.toJS() ?? {}) as Partial<TasksFile>).tasks ?? [];
    const task = { id: nextTaskId(existing), ...rest, created: today } as Task;
    mergeInto(doc, ['tasks'], [...existing, task]);
    return { task, hash: await saveYaml(path, doc, hash) };
  },
  async remove(path: string, id: string, hash: string): Promise<string> {
    const { doc } = await loadYaml(path);
    const existing = ((doc.toJS() ?? {}) as Partial<TasksFile>).tasks ?? [];
    const index = existing.findIndex((t) => t.id === id);
    if (index === -1) throw new TaskNotFoundError(id);
    doc.deleteIn(['tasks', index]);
    return saveYaml(path, doc, hash);
  },
};

export const goals = yamlResource<GoalsFile>('objectives', GoalsFileSchema, (d) => ({ ...d, last_updated: localToday() }));
export const schedules = yamlResource<SchedulesFile>('schedules', SchedulesFileSchema);
