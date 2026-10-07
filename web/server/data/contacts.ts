import { readdir } from 'node:fs/promises';
import type { Contact, ContactSection, ContactSummary, Versioned } from '../../shared/types';
import { localToday, staleness } from '../../shared/dates';
import { ConflictError, readText, removeChecked, writeAtomic } from './files';
import { InvalidSlugError, contactPath, slugify, type CosPaths } from './paths';
import { ContactSchema } from './schemas';

export class ContactExistsError extends Error {
  constructor(slug: string) {
    super(`A contact file named ${slug}.md already exists`);
    this.name = 'ContactExistsError';
  }
}

type Fields = [string, string][];

const unbold = (s: string) => s.trim().replace(/^\*\*(.*)\*\*$/, '$1').trim();

function parseTable(body: string): Fields | null {
  const rows = body.split('\n').map((r) => r.trim()).filter(Boolean);
  if (rows.length < 2 || rows[0].split('|').length !== 4 || !/^\|[\s:|-]+\|$/.test(rows[1])) return null;
  const out: Fields = [];
  for (const row of rows.slice(2)) {
    const m = /^\|([^|]*)\|(.*)\|$/.exec(row);
    if (!m) return null;
    out.push([unbold(m[1]), m[2].trim().replace(/\\\|/g, '|')]);
  }
  return out;
}

function parseFieldList(body: string): Fields | null {
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const out: Fields = [];
  for (const line of lines) {
    const m = /^\s*[-*]\s+\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (!m) return null;
    out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

const renderTable = (fields: Fields) =>
  ['| Field | Value |', '|-------|-------|', ...fields.map(([k, v]) => `| **${k}** | ${v.replace(/\|/g, '\\|')} |`)].join('\n');
const renderFieldList = (fields: Fields) => fields.map(([k, v]) => `- **${k}:** ${v}`).join('\n');
const sameFields = (a: Fields, b: Fields) => a.length === b.length && a.every(([k, v], i) => b[i][0] === k && b[i][1] === v);

function toSection(heading: string, body: string): ContactSection {
  const key = heading.trim().toLowerCase();
  if (key === 'quick reference') {
    const fields = parseTable(body);
    if (fields) return { heading, kind: 'table', body, fields };
  }
  if (key === 'last interaction') {
    const fields = parseFieldList(body);
    if (fields) return { heading, kind: 'fields', body, fields };
  }
  return { heading, kind: 'raw', body, fields: [] };
}

export function parseContact(slug: string, text: string): Contact {
  let title = '';
  let rest = text;
  if (text.startsWith('# ')) {
    const nl = text.indexOf('\n');
    title = nl === -1 ? text.slice(2) : text.slice(2, nl);
    rest = nl === -1 ? '' : text.slice(nl + 1);
  }
  const parts = rest.split(/^## /m);
  const sections = parts.slice(1).map((part) => {
    const nl = part.indexOf('\n');
    return toSection(nl === -1 ? part : part.slice(0, nl), nl === -1 ? '' : part.slice(nl + 1));
  });
  return { slug, title, preamble: parts[0], sections };
}

function sectionBody(s: ContactSection): string {
  if (s.kind === 'raw') return s.body;
  const original = s.kind === 'table' ? parseTable(s.body) : parseFieldList(s.body);
  if (original && sameFields(original, s.fields)) return s.body;
  const core = s.kind === 'table' ? renderTable(s.fields) : renderFieldList(s.fields);
  const leading = /^\n*/.exec(s.body)![0] || '\n';
  const trailing = /\n*$/.exec(s.body)![0] || '\n';
  return leading + core + trailing;
}

// A segment followed by another heading must end in a newline, or the next "## " fuses onto its last line.
// Empty segments are left alone: nothing can fuse, and untouched files stay byte-identical.
const closed = (text: string) => (text === '' || text.endsWith('\n') ? text : `${text}\n\n`);

export function serializeContact(c: Contact): string {
  const head = c.title ? `# ${c.title}\n` : '';
  const last = c.sections.length - 1;
  const sections = c.sections.map((s, i) => {
    const body = sectionBody(s);
    return `## ${s.heading}\n${i < last ? closed(body) : body}`;
  });
  return head + (c.sections.length > 0 ? closed(c.preamble) : c.preamble) + sections.join('');
}

export function summarize(c: Contact, today: string): ContactSummary {
  const qr = c.sections.find((s) => s.kind === 'table')?.fields ?? [];
  const li = c.sections.find((s) => s.kind === 'fields')?.fields ?? [];
  const get = (fields: Fields, label: string) => fields.find(([k]) => k.toLowerCase() === label)?.[1].trim() || null;
  const name = get(qr, 'name') ?? (c.title.replace(/^Contact:\s*/i, '').trim() || c.slug);
  const tierText = get(qr, 'tier');
  const tier = tierText && /^\d+$/.test(tierText) ? Number(tierText) : null;
  const date = get(li, 'date');
  const lastInteraction = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  return { slug: c.slug, name, role: get(qr, 'role'), tier, lastInteraction, ...staleness(tier, lastInteraction, today) };
}

export function newContactMarkdown(name: string): string {
  return `# Contact: ${name}

## Quick Reference

| Field | Value |
|-------|-------|
| **Name** | ${name.replace(/\|/g, '\\|')} |
| **Role** |  |
| **Tier** | 3 |
| **Email** |  |
| **Phone** |  |
| **LinkedIn** |  |
| **Location** |  |
| **Met through** |  |

## Relationship Context

## Communication Style

## Personal Notes

## Interaction History

| Date | Type | Summary |
|------|------|---------|

## Talking Points for Next Interaction

## Last Interaction

- **Date:** 
- **Channel:** 
- **Follow-up needed:** 
`;
}

export async function listContacts(paths: CosPaths, today = localToday()): Promise<ContactSummary[]> {
  let files: string[];
  try {
    files = await readdir(paths.contactsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: ContactSummary[] = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    let path: string;
    try {
      path = contactPath(paths, slug);
    } catch {
      continue; // filename we can't address safely (spaces, dots); still editable on disk
    }
    out.push(summarize(parseContact(slug, (await readText(path)).text), today));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContact(paths: CosPaths, slug: string): Promise<Versioned<Contact>> {
  const { text, hash } = await readText(contactPath(paths, slug));
  return { data: parseContact(slug, text), hash };
}

export async function putContact(paths: CosPaths, slug: string, data: unknown, hash: string): Promise<string> {
  const path = contactPath(paths, slug);
  const contact = ContactSchema.parse(data);
  return writeAtomic(path, serializeContact({ ...contact, slug }), hash);
}

export async function createContact(paths: CosPaths, name: string): Promise<{ slug: string; hash: string }> {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length > 100) throw new InvalidSlugError(clean.slice(0, 20));
  const slug = slugify(clean);
  const path = contactPath(paths, slug); // throws InvalidSlugError for ''
  try {
    return { slug, hash: await writeAtomic(path, newContactMarkdown(clean), null) };
  } catch (err) {
    if (err instanceof ConflictError) throw new ContactExistsError(slug);
    throw err;
  }
}

export async function deleteContact(paths: CosPaths, slug: string, hash: string): Promise<void> {
  await removeChecked(contactPath(paths, slug), hash);
}

export { InvalidSlugError };
