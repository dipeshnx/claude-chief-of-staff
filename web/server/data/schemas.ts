import { z } from 'zod';

const DateStr = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')]);

export const TaskSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().nullish(),
  status: z.enum(['pending', 'in_progress', 'blocked', 'complete']),
  priority: z.number().int().min(1).max(4),
  due_date: DateStr.nullish(),
  goal_alignment: z.string().nullish(),
  created: DateStr.nullish(),
  notes: z.string().nullish(),
});
export const TasksFileSchema = z.looseObject({ tasks: z.array(TaskSchema) }).superRefine((data, ctx) => {
  const seenIds = new Set<string>();
  const tasks = data.tasks as Array<{ id?: string }>;
  tasks.forEach((task, index) => {
    if (task.id) {
      if (seenIds.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate task id ${task.id}`,
          path: ['tasks', index, 'id'],
        });
      }
      seenIds.add(task.id);
    }
  });
});
export const NewTaskSchema = TaskSchema.omit({ id: true, created: true }).extend({
  status: TaskSchema.shape.status.default('pending'),
  priority: TaskSchema.shape.priority.default(3),
});

export const ObjectiveSchema = z.looseObject({
  name: z.string().trim().min(1, 'Name is required'),
  target: z.string().nullish(),
  priority: z.number().int().min(1).nullish(),
  key_results: z.array(z.string()).nullish(),
  progress: z.number().min(0).max(1).nullish(),
  status: z.enum(['on_track', 'at_risk', 'behind', 'complete']).nullish(),
  notes: z.string().nullish(),
});
export const GoalsFileSchema = z.looseObject({
  quarter: z.string().nullish(),
  last_updated: z.string().nullish(),
  objectives: z.array(ObjectiveSchema),
});

export const ScheduleSchema = z.looseObject({
  name: z.string().trim().min(1, 'Name is required'),
  skill: z.string().trim().startsWith('/', 'Skill must start with /'),
  frequency: z.string().nullish(),
  enabled: z.boolean().nullish(),
  notes: z.string().nullish(),
});
export const SchedulesFileSchema = z.looseObject({ schedules: z.array(ScheduleSchema) });

const oneLine = (s: string) => !s.includes('\n');
const ONE_LINE = 'Must be a single line';

export const ContactSchema = z.object({
  slug: z.string(),
  title: z.string().refine(oneLine, ONE_LINE),
  preamble: z.string(),
  sections: z.array(
    z.object({
      heading: z.string().refine((h) => h.trim().length > 0, 'Heading is required').refine(oneLine, 'Heading must be one line'),
      kind: z.enum(['table', 'fields', 'raw']),
      body: z.string(),
      fields: z.array(z.tuple([z.string().refine(oneLine, ONE_LINE), z.string().refine(oneLine, ONE_LINE)])),
    }),
  ),
});
