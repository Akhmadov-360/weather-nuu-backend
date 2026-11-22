import { createHash } from "node:crypto";

export type KnowledgeLang = "ru" | "uz" | "en";

/** The header of a source file: where the text comes from, in what language, and what kind of text it is. */
export type DocumentHeader = {
  source: string;
  url?: string;
  lang: KnowledgeLang;
  /** For example `standard`, `sensor`, `station`: lets a search be limited before ranking. */
  kind: string;
  title?: string;
};

export type RawChunk = { title: string; text: string; contentHash: string };

const LANGS = new Set<string>(["ru", "uz", "en"]);

/** A file starts with `---`, lines `key: value`, `---`, then the text. */
export function parseDocument(raw: string): { header: DocumentHeader; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("A knowledge file must start with a header between two --- lines");
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const need = (key: string): string => {
    const value = fields.get(key);
    if (!value) throw new Error(`The header has no "${key}"`);
    return value;
  };
  const lang = need("lang");
  if (!LANGS.has(lang)) throw new Error(`Unknown language "${lang}" (ru, uz or en)`);
  const header: DocumentHeader = { source: need("source"), lang: lang as KnowledgeLang, kind: need("kind") };
  if (fields.get("url")) header.url = fields.get("url")!;
  if (fields.get("title")) header.title = fields.get("title")!;
  return { header, body: match[2]! };
}

export function hashChunk(title: string, text: string): string {
  return createHash("sha256").update(`${title}\n${text}`).digest("hex");
}

type Section = { path: string[]; paragraphs: string[] };

/** The title of a document and its first heading are usually the same words: say them once. */
function dedupe(path: string[]): string[] {
  return path.filter((part, i) => i === 0 || part !== path[i - 1]);
}

function sections(body: string, rootTitle: string): Section[] {
  const out: Section[] = [];
  const path: string[] = [];
  let current: Section = { path: [rootTitle], paragraphs: [] };
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) current.paragraphs.push(text);
    paragraph = [];
  };
  const flushSection = () => {
    flushParagraph();
    if (current.paragraphs.length) out.push(current);
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushSection();
      const level = heading[1]!.length;
      path.length = level - 1;
      path[level - 1] = heading[2]!;
      current = { path: dedupe([rootTitle, ...path.filter(Boolean)]), paragraphs: [] };
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushSection();
  return out;
}

/**
 * Fragments by headings: every section is a fragment; a section longer than `targetChars` (about 500 tokens at
 * four characters a token) is cut at paragraph borders, and each next piece starts with the tail of the previous
 * one (up to `overlapChars`), so that a sentence at a border is found from both sides. The title of a fragment
 * is the path of headings.
 */
export function chunkDocument(body: string, rootTitle: string, options: { targetChars?: number; overlapChars?: number } = {}): RawChunk[] {
  const target = options.targetChars ?? 2000;
  const overlap = options.overlapChars ?? 200;
  const chunks: RawChunk[] = [];
  for (const section of sections(body, rootTitle)) {
    const title = section.path.join(" / ");
    let parts: string[] = [];
    let length = 0;
    const emit = () => {
      const text = parts.join("\n\n");
      chunks.push({ title, text, contentHash: hashChunk(title, text) });
    };
    for (const paragraph of section.paragraphs) {
      if (parts.length && length + paragraph.length > target) {
        emit();
        const tail = parts[parts.length - 1]!;
        parts = tail.length <= overlap ? [tail] : [tail.slice(tail.length - overlap)];
        length = parts[0]!.length;
      }
      parts.push(paragraph);
      length += paragraph.length;
    }
    if (parts.length) emit();
  }
  return chunks;
}
