import { describe, expect, it } from "vitest";

import type { Doc } from "../types";
import { buildDocTree, descendantIds, flattenDocTree } from "./tree";

/** The wiki hierarchy is a pure shape over the flat workspace read (056's
 *  parent_id + position), so it is tested without a database. */

function doc(id: number, parentId: number | null, position = 0, title = `d${id}`): Doc {
  return {
    id,
    workspaceId: "w",
    boardId: null,
    parentId,
    title,
    body: "",
    kind: "page",
    position,
    isPublished: false,
    createdBy: "u",
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  };
}

/** id/depth pairs, in render order — what a sidebar actually consumes. */
function rendered(docs: Doc[]): [number, number][] {
  return flattenDocTree(buildDocTree(docs)).map((n) => [n.doc.id, n.depth]);
}

describe("buildDocTree", () => {
  it("nests children under parents, depth-first", () => {
    expect(
      rendered([doc(1, null), doc(2, 1), doc(3, 2), doc(4, null)])
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 0],
    ]);
  });

  it("orders siblings by position, then id", () => {
    expect(rendered([doc(3, null, 1), doc(1, null, 2), doc(2, null, 1)])).toEqual([
      [2, 0],
      [3, 0],
      [1, 0],
    ]);
  });

  it("shows a doc whose parent is missing as a root", () => {
    // The parent lost a search filter; the child must not vanish with it.
    expect(rendered([doc(2, 99)])).toEqual([[2, 0]]);
  });

  it("keeps every doc exactly once even given a parent cycle", () => {
    // 1 → 2 → 1: unreachable from any root, so both surface as roots.
    const ids = rendered([doc(1, 2), doc(2, 1), doc(3, null)]);
    expect(ids).toEqual([
      [3, 0],
      [1, 0],
      [2, 1],
    ]);
    expect(ids).toHaveLength(3);
  });

  it("is empty for no docs", () => {
    expect(buildDocTree([])).toEqual([]);
  });
});

describe("descendantIds", () => {
  it("finds everything beneath a doc, excluding itself", () => {
    const docs = [doc(1, null), doc(2, 1), doc(3, 2), doc(4, null)];
    expect([...descendantIds(docs, 1)].sort()).toEqual([2, 3]);
    expect([...descendantIds(docs, 3)]).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const docs = [doc(1, 2), doc(2, 1)];
    expect([...descendantIds(docs, 1)]).toEqual([2]);
  });
});
