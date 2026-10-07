import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';
import { readText, writeAtomic } from './files';

export class YamlParseError extends Error {
  constructor(public readonly file: string, message: string, public readonly line: number | null) {
    super(message);
    this.name = 'YamlParseError';
  }
}

export async function loadYaml(path: string): Promise<{ doc: Document; hash: string }> {
  const { text, hash } = await readText(path);
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    throw new YamlParseError(path, first.message, first.linePos?.[0]?.line ?? null);
  }
  return { doc, hash };
}

export async function saveYaml(path: string, doc: Document, expectedHash: string): Promise<string> {
  return writeAtomic(path, doc.toString({ lineWidth: 0 }), expectedHash);
}

type Key = string | number;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Make the node at `path` equal `value`, editing existing nodes in place so
 * comments and formatting on unchanged parts of the document survive.
 */
export function mergeInto(doc: Document, path: Key[], value: unknown): void {
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true);

  if (isPlainObject(value) && isMap(node)) {
    const keys = node.items.map((pair) => (isScalar(pair.key) ? pair.key.value : pair.key));
    for (const key of keys) if (typeof key === 'string' && !(key in value)) node.delete(key);
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (node.has(key)) mergeInto(doc, [...path, key], child);
      else node.set(key, doc.createNode(child));
    }
    return;
  }

  if (Array.isArray(value) && isSeq(node)) {
    if (node.items.length === 0 && value.length > 0) node.flow = false;
    node.items.splice(value.length);
    value.forEach((child, i) => {
      if (i < node.items.length) mergeInto(doc, [...path, i], child);
      else node.items.push(doc.createNode(child));
    });
    return;
  }

  if (isScalar(node) && !isPlainObject(value) && !Array.isArray(value)) {
    if (node.value !== value) node.value = value;
    return;
  }

  if (path.length === 0) doc.contents = doc.createNode(value) as Document['contents'];
  else doc.setIn(path, doc.createNode(value));
}
