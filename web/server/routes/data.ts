import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CosPaths } from '../data/paths';
import { goals, schedules, tasks } from '../data/yamlFiles';
import { createContact, deleteContact, getContact, listContacts, putContact } from '../data/contacts';

const Write = z.object({ data: z.unknown(), hash: z.string().min(1) });
const HashQuery = z.object({ hash: z.string().min(1) });
type Slug = { Params: { slug: string } };

export function registerDataRoutes(app: FastifyInstance, { paths }: { paths: CosPaths }): void {
  app.get('/api/tasks', () => tasks.get(paths.tasks));
  app.put('/api/tasks', async (req) => {
    const b = Write.parse(req.body);
    return { hash: await tasks.put(paths.tasks, b.data, b.hash) };
  });
  app.post('/api/tasks', async (req) => {
    const b = z.object({ task: z.unknown(), hash: z.string().min(1) }).parse(req.body);
    return tasks.create(paths.tasks, b.task, b.hash);
  });
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    const q = HashQuery.parse(req.query);
    return { hash: await tasks.remove(paths.tasks, req.params.id, q.hash) };
  });

  app.get('/api/goals', () => goals.get(paths.goals));
  app.put('/api/goals', async (req) => {
    const b = Write.parse(req.body);
    return { hash: await goals.put(paths.goals, b.data, b.hash) };
  });

  app.get('/api/schedules', () => schedules.get(paths.schedules));
  app.put('/api/schedules', async (req) => {
    const b = Write.parse(req.body);
    return { hash: await schedules.put(paths.schedules, b.data, b.hash) };
  });

  app.get('/api/contacts', () => listContacts(paths));
  app.post('/api/contacts', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    return reply.code(201).send(await createContact(paths, b.name));
  });
  app.get<Slug>('/api/contacts/:slug', (req) => getContact(paths, req.params.slug));
  app.put<Slug>('/api/contacts/:slug', async (req) => {
    const b = Write.parse(req.body);
    return { hash: await putContact(paths, req.params.slug, b.data, b.hash) };
  });
  app.delete<Slug>('/api/contacts/:slug', async (req) => {
    const q = HashQuery.parse(req.query);
    await deleteContact(paths, req.params.slug, q.hash);
    return { ok: true };
  });
}
