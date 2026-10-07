import { join } from 'node:path';

export interface CosPaths { home: string; goals: string; tasks: string; schedules: string; contactsDir: string; sessions: string; transcriptsDir: string }

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(`Invalid contact name: ${JSON.stringify(slug)}`);
    this.name = 'InvalidSlugError';
  }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function cosPaths(home: string): CosPaths {
  return {
    home,
    goals: join(home, 'goals.yaml'),
    tasks: join(home, 'my-tasks.yaml'),
    schedules: join(home, 'schedules.yaml'),
    contactsDir: join(home, 'contacts'),
    sessions: join(home, 'cos-web', 'sessions.json'),
    transcriptsDir: join(home, 'cos-web', 'transcripts'),
  };
}

export function contactPath(paths: CosPaths, slug: string): string {
  if (!SLUG.test(slug)) throw new InvalidSlugError(slug);
  return join(paths.contactsDir, `${slug}.md`);
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
