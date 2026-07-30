import type { Doc } from "../types";

/**
 * `[[Wiki links]]` — the wiki idiom of naming a page by its title, resolved at
 * render time against the docs the client already holds.
 *
 * Resolution is by title, not by id, because the title is what an author types
 * and the whole point of the syntax is that you can write a link before you know
 * (or care) which row it lands on. The cost is that a title is not stable: rename
 * a page and links to it stop resolving. That is the wiki bargain, and it is
 * survivable precisely because an unresolved link renders as the literal
 * `[[Name]]` — visibly a link to a page that is not there, which is exactly what
 * it is, rather than a dead anchor that looks live.
 *
 * Matching is case- and whitespace-insensitive on the title. Where two docs share
 * a title the first in the given order wins; deciding between them would need an
 * intent the syntax cannot express.
 */

/** `[[` … `]]` with no nested bracket, so an unclosed `[[` cannot swallow a page. */
const WIKI_LINK = /\[\[([^[\]]+)\]\]/g;

function normalize(title: string): string {
  return title.trim().toLowerCase();
}

/** Every name a body links to, in order of appearance, de-duplicated. */
export function wikiLinkNames(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(WIKI_LINK)) {
    const name = match[1].trim();
    const key = normalize(name);
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The doc a `[[name]]` points at, or null when nothing carries that title. */
export function resolveWikiLink(name: string, docs: Doc[]): Doc | null {
  const key = normalize(name);
  return docs.find((doc) => normalize(doc.title) === key) ?? null;
}

/**
 * Rewrites `[[Name]]` into a Markdown link to the doc so the existing renderer
 * handles it — `#doc-<id>`, the anchor the sidebar entries already carry, which
 * the dialog also intercepts to select the target. Unresolved names are returned
 * untouched (see above).
 */
export function resolveWikiLinks(body: string, docs: Doc[]): string {
  return body.replace(WIKI_LINK, (match, name: string) => {
    const doc = resolveWikiLink(name, docs);
    return doc ? `[${doc.title}](#doc-${doc.id})` : match;
  });
}

/** The names in a body that resolve to nothing — the wiki's "wanted pages", so
 *  the dialog can offer to create one instead of leaving a dead end. */
export function brokenWikiLinks(body: string, docs: Doc[]): string[] {
  return wikiLinkNames(body).filter((name) => resolveWikiLink(name, docs) === null);
}

/** The doc id in a `#doc-<id>` anchor, or null for any other href. Shared by the
 *  preview's click interception so the parsing rule lives with the writing rule. */
export function docIdFromAnchor(href: string | null | undefined): number | null {
  const match = /^#doc-(\d+)$/.exec(href ?? "");
  return match ? Number(match[1]) : null;
}
