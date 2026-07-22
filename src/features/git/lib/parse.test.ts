import { describe, expect, it } from "vitest";

import { parseBranchRef, parseIssueRefs, resolveTaskRefs } from "./parse";

/**
 * Smart-commit parsing (2.0): the pure reference extraction the ingress relies on.
 */

describe("parseBranchRef", () => {
  it("reads the leading numeric segment of a branch", () => {
    expect(parseBranchRef("feature/123-add-oauth")).toBe(123);
    expect(parseBranchRef("123-fix-bug")).toBe(123);
    expect(parseBranchRef("bugfix/456")).toBe(456);
    expect(parseBranchRef("789")).toBe(789);
  });

  it("ignores version strings and non-numeric branches", () => {
    expect(parseBranchRef("release/v1.2.3")).toBeNull();
    expect(parseBranchRef("main")).toBeNull();
    expect(parseBranchRef("feature/add-thing")).toBeNull();
    expect(parseBranchRef("v2")).toBeNull();
    expect(parseBranchRef(undefined)).toBeNull();
    expect(parseBranchRef("")).toBeNull();
  });
});

describe("parseIssueRefs", () => {
  it("extracts #123 references, deduped", () => {
    expect(parseIssueRefs("Fixes #123")).toEqual([123]);
    expect(parseIssueRefs("Closes #45 and #67")).toEqual([45, 67]);
    expect(parseIssueRefs("#12 #12 #12")).toEqual([12]);
  });

  it("does not match bare numbers or fragment-like ids", () => {
    expect(parseIssueRefs("released version 1.2.3")).toEqual([]);
    expect(parseIssueRefs("#123abc")).toEqual([]); // word boundary
    expect(parseIssueRefs("")).toEqual([]);
    expect(parseIssueRefs(null)).toEqual([]);
  });
});

describe("resolveTaskRefs", () => {
  const base = {
    provider: "github" as const,
    kind: "pr" as const,
    externalId: "42",
    url: "https://github.com/o/r/pull/42",
    state: "open" as const,
    title: "A PR",
    action: "git.pr_opened" as const,
  };

  it("unions the branch id and message references", () => {
    expect(
      resolveTaskRefs({
        ...base,
        branch: "feature/7-thing",
        messages: ["Closes #7", "also touches #9"],
      })
    ).toEqual([7, 9]);
  });

  it("returns nothing when an event references no task", () => {
    expect(
      resolveTaskRefs({ ...base, branch: "main", messages: ["no refs here"] })
    ).toEqual([]);
  });
});
