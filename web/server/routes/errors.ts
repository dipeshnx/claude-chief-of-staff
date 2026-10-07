import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { ConflictError, NotFoundError } from '../data/files';
import { YamlParseError } from '../data/yamlStore';
import { InvalidSlugError } from '../data/paths';
import { TaskNotFoundError } from '../data/yamlFiles';
import { ContactExistsError } from '../data/contacts';

export function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ConflictError)
    return reply.code(409).send({ error: 'conflict', message: 'This file changed since you loaded it. Reload to see the latest version.' });
  if (err instanceof ContactExistsError) return reply.code(409).send({ error: 'exists', message: err.message });
  if (err instanceof YamlParseError) return reply.code(422).send({ error: 'parse', message: err.message, line: err.line });
  if (err instanceof ZodError)
    return reply.code(400).send({ error: 'invalid', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  if (err instanceof InvalidSlugError) return reply.code(400).send({ error: 'invalid_slug', message: err.message });
  if (err instanceof NotFoundError || err instanceof TaskNotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
  console.error('[cos-web] internal error:', err);
  return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
}
