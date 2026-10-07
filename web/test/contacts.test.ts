import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { ConflictError } from '../server/data/files';
import { cosPaths, InvalidSlugError } from '../server/data/paths';
import {
  ContactExistsError, createContact, deleteContact, getContact, listContacts,
  newContactMarkdown, parseContact, putContact, serializeContact, summarize,
} from '../server/data/contacts';
import { REPO_ROOT, makeHome } from './helpers';

const template = () => readFile(join(REPO_ROOT, 'contacts/example-contact.md'), 'utf8');

describe('parseContact / serializeContact', () => {
  it('round-trips the shipped template byte-for-byte', async () => {
    const text = await template();
    expect(serializeContact(parseContact('example-contact', text))).toBe(text);
  });

  it('extracts Quick Reference and Last Interaction fields', async () => {
    const c = parseContact('example-contact', await template());
    expect(c.title).toBe('Contact: Jane Smith');
    const qr = c.sections.find((s) => s.heading === 'Quick Reference')!;
    expect(qr.kind).toBe('table');
    expect(qr.fields).toContainEqual(['Name', 'Jane Smith']);
    expect(qr.fields).toContainEqual(['Tier', '2']);
    const li = c.sections.find((s) => s.heading === 'Last Interaction')!;
    expect(li.kind).toBe('fields');
    expect(li.fields).toContainEqual(['Date', '2026-01-15']);
    expect(c.sections.find((s) => s.heading === 'Personal Notes')!.kind).toBe('raw');
  });

  it('re-renders only the edited section', async () => {
    const text = await template();
    const c = parseContact('example-contact', text);
    const qr = c.sections.find((s) => s.kind === 'table')!;
    qr.fields = qr.fields.map(([k, v]) => [k, k === 'Tier' ? '1' : v]);
    qr.fields.push(['Pronouns', 'she/her | they/them']);
    const out = serializeContact(c);
    const again = parseContact('example-contact', out);
    const qr2 = again.sections.find((s) => s.kind === 'table')!;
    expect(qr2.fields).toContainEqual(['Tier', '1']);
    expect(qr2.fields).toContainEqual(['Pronouns', 'she/her | they/them']);
    // Everything after Quick Reference is untouched
    expect(out.slice(out.indexOf('## Relationship Context'))).toBe(text.slice(text.indexOf('## Relationship Context')));
  });

  it('handles hand-written files that ignore the template', () => {
    const a = '# Notes on Bob\nMet at the offsite.\n\n### Random\nstuff\n';
    const b = 'No heading at all\n## Odd Heading\ntext';
    const ca = parseContact('bob', a);
    const cb = parseContact('bob2', b);
    expect(serializeContact(ca)).toBe(a);
    expect(serializeContact(cb)).toBe(b);
    expect(summarize(ca, '2026-10-06')).toMatchObject({ name: 'Notes on Bob', tier: null, lastInteraction: null, stale: false });
    expect(summarize(cb, '2026-10-06').name).toBe('bob2');
  });
});

describe('serializeContact section boundaries', () => {
  it('keeps headings when a raw body lacks a trailing newline', () => {
    const c = parseContact('pat-rivera', newContactMarkdown('Pat Rivera'));
    const headings = c.sections.map((s) => s.heading);
    const i = headings.indexOf('Personal Notes');
    c.sections[i] = { ...c.sections[i], body: `${c.sections[i].body}Loves chess` };
    const text = serializeContact(c);
    const back = parseContact('pat-rivera', text);
    expect(back.sections.map((s) => s.heading)).toEqual(headings);
    expect(headings).toContain('Interaction History');
    expect(back.sections[i].body).toContain('Loves chess');
    expect(text).toContain('Loves chess\n\n## Interaction History');
  });

  it('keeps the first heading when the preamble lacks a trailing newline', () => {
    const c = parseContact('pat-rivera', newContactMarkdown('Pat Rivera'));
    const headings = c.sections.map((s) => s.heading);
    c.preamble = 'Intro text';
    const back = parseContact('pat-rivera', serializeContact(c));
    expect(back.sections.map((s) => s.heading)).toEqual(headings);
    expect(back.preamble).toContain('Intro text');
  });
});

describe('summarize', () => {
  it('derives tier and staleness', async () => {
    const s = summarize(parseContact('example-contact', await template()), '2026-03-01');
    expect(s).toEqual({ slug: 'example-contact', name: 'Jane Smith', role: 'VP Engineering at TechCorp', tier: 2, lastInteraction: '2026-01-15', daysSince: 45, stale: true });
  });
});

describe('newContactMarkdown', () => {
  it('produces a parseable, round-trippable skeleton', () => {
    const text = newContactMarkdown('Pat Rivera');
    const c = parseContact('pat-rivera', text);
    expect(serializeContact(c)).toBe(text);
    expect(summarize(c, '2026-10-06')).toMatchObject({ name: 'Pat Rivera', tier: 3, lastInteraction: null, stale: true });
    expect(c.sections.map((s) => s.kind)).toContain('fields');
  });
});

describe('store', () => {
  it('lists valid contact files only, sorted by name', async () => {
    const home = await makeHome();
    const paths = cosPaths(home);
    await writeFile(join(paths.contactsDir, 'Bad Name.md'), '# x\n');
    await writeFile(join(paths.contactsDir, 'notes.txt'), 'x');
    await writeFile(join(paths.contactsDir, 'aaron.md'), '# Contact: Aaron A\n');
    const list = await listContacts(paths, '2026-03-01');
    expect(list.map((c) => c.slug)).toEqual(['aaron', 'example-contact']);
  });

  it('returns [] when the contacts dir is missing', async () => {
    expect(await listContacts(cosPaths('/nonexistent-cos-home'))).toEqual([]);
  });

  it('creates, edits with hash check, and deletes', async () => {
    const home = await makeHome();
    const paths = cosPaths(home);
    const { slug } = await createContact(paths, '  José Núñez ');
    expect(slug).toBe('jose-nunez');
    await expect(createContact(paths, 'jose nunez')).rejects.toBeInstanceOf(ContactExistsError);

    const got = await getContact(paths, slug);
    got.data.sections.find((s) => s.heading === 'Personal Notes')!.body = '\n- Loves chess (added 2026-10-06)\n\n';
    const hash = await putContact(paths, slug, got.data, got.hash);
    expect(await readFile(join(paths.contactsDir, 'jose-nunez.md'), 'utf8')).toContain('Loves chess');
    await expect(putContact(paths, slug, got.data, got.hash)).rejects.toBeInstanceOf(ConflictError);
    await deleteContact(paths, slug, hash);
    expect((await listContacts(paths)).map((c) => c.slug)).toEqual(['example-contact']);
  });

  it('rejects unsafe slugs and empty names', async () => {
    const paths = cosPaths(await makeHome());
    await expect(getContact(paths, '../goals')).rejects.toBeInstanceOf(InvalidSlugError);
    await expect(createContact(paths, '!!!')).rejects.toBeInstanceOf(InvalidSlugError);
  });

  it('saves untouched hand-written CRLF and template files byte-identically', async () => {
    const paths = cosPaths(await makeHome());
    const crlf = '# Contact: Crlf Person\r\n\r\n## Quick Reference \r\n\r\n| Field | Value |\r\n|-------|-------|\r\n| **Name** | Crlf Person |\r\n\r\n## Notes  \r\nfree text\r\n';
    await writeFile(join(paths.contactsDir, 'crlf.md'), crlf);
    const tpl = await readFile(join(paths.contactsDir, 'example-contact.md'), 'utf8');
    for (const [slug, original] of [['crlf', crlf], ['example-contact', tpl]] as const) {
      const got = await getContact(paths, slug);
      await putContact(paths, slug, got.data, got.hash);
      expect(await readFile(join(paths.contactsDir, `${slug}.md`), 'utf8')).toBe(original);
    }
  });

  it('sanitizes created names', async () => {
    const paths = cosPaths(await makeHome());
    const { slug } = await createContact(paths, 'Pat\n## Evil');
    expect(slug).toBe('pat-evil');
    const text = await readFile(join(paths.contactsDir, 'pat-evil.md'), 'utf8');
    expect(text).not.toMatch(/^## Evil/m);
    expect(parseContact(slug, text).title).toBe('Contact: Pat ## Evil');
    const r = await createContact(paths, 'A | B');
    const c = parseContact(r.slug, await readFile(join(paths.contactsDir, `${r.slug}.md`), 'utf8'));
    expect(c.sections[0].fields).toContainEqual(['Name', 'A | B']);
    await expect(createContact(paths, 'x'.repeat(101))).rejects.toBeInstanceOf(InvalidSlugError);
  });

  it('rejects multi-line field values without touching the file', async () => {
    const paths = cosPaths(await makeHome());
    const { slug } = await createContact(paths, 'Lee Ng');
    const got = await getContact(paths, slug);
    const before = await readFile(join(paths.contactsDir, `${slug}.md`), 'utf8');
    got.data.sections[0].fields[0][1] = 'a\nb';
    await expect(putContact(paths, slug, got.data, got.hash)).rejects.toBeInstanceOf(ZodError);
    expect(await readFile(join(paths.contactsDir, `${slug}.md`), 'utf8')).toBe(before);
  });
});
