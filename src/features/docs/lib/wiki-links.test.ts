import { describe, expect, it } from "vitest";

import type { Doc } from "../types";
import {
  brokenWikiLinks,
  docIdFromAnchor,
  resolveWikiLink,
  resolveWikiLinks,
  wikiLinkNames,
} from "./wiki-links";

function doc(id: number, title: string): Doc {
  return {
    id,
    workspaceId: "w",
    boardId: null,
    parentId: null,
    title,
    body: "",
    kind: "page",
    position: 0,
    isPublished: false,
    createdBy: "u",
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  };
}

const docs = [doc(7, "Runbook"), doc(9, "On call")];

describe("wikiLinkNames", () => {
  it("collects each distinct name in order of appearance", () => {
    expect(wikiLinkNames("see [[Runbook]] then [[On call]] and [[runbook]] again")).toEqual([
      "Runbook",
      "On call",
    ]);
  });

  it("ignores an empty name and an unclosed bracket", () => {
    expect(wikiLinkNames("[[]] and [[ ]] and [[never closed")).toEqual([]);
  });

  it("does not let one unclosed link swallow the next", () => {
    // The pattern refuses nested brackets, so the second link still resolves.
    expect(wikiLinkNames("[[a [[Runbook]]")).toEqual(["Runbook"]);
  });
});

describe("resolveWikiLink", () => {
  it("matches a title regardless of case and surrounding space", () => {
    expect(resolveWikiLink("  runbook ", docs)?.id).toBe(7);
  });

  it("is null when no doc carries the name", () => {
    expect(resolveWikiLink("Postmortem", docs)).toBeNull();
  });

  it("takes the first of two docs sharing a title", () => {
    expect(resolveWikiLink("Dupe", [doc(1, "Dupe"), doc(2, "Dupe")])?.id).toBe(1);
  });
});

describe("resolveWikiLinks", () => {
  it("rewrites a resolved name into a link to the doc's anchor", () => {
    expect(resolveWikiLinks("read [[runbook]] first", docs)).toBe(
      "read [Runbook](#doc-7) first"
    );
  });

  it("leaves an unresolved name as literal text", () => {
    // Visibly a link to a page that does not exist — not a dead anchor that
    // looks live.
    expect(resolveWikiLinks("read [[Postmortem]]", docs)).toBe("read [[Postmortem]]");
  });

  it("leaves ordinary Markdown links alone", () => {
    const md = "[docs](https://example.test) and [x][ref]";
    expect(resolveWikiLinks(md, docs)).toBe(md);
  });
});

describe("brokenWikiLinks", () => {
  it("reports only the names nothing answers to", () => {
    expect(brokenWikiLinks("[[Runbook]] [[Postmortem]] [[On call]]", docs)).toEqual([
      "Postmortem",
    ]);
  });
});

describe("docIdFromAnchor", () => {
  it("reads the id out of a doc anchor and refuses anything else", () => {
    expect(docIdFromAnchor("#doc-42")).toBe(42);
    expect(docIdFromAnchor("#doc-")).toBeNull();
    expect(docIdFromAnchor("#doc-4x")).toBeNull();
    expect(docIdFromAnchor("https://example.test")).toBeNull();
    expect(docIdFromAnchor(null)).toBeNull();
  });
});
