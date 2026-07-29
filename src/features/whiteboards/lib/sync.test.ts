import { describe, expect, it } from "vitest";

import { isNewer, localChanges, sceneDiffers, sceneFromShared, type SyncElement } from "./sync";

/**
 * The rules that decide whether two people drawing at once keep both drawings.
 * Every one of these is a case the pre-088 whole-scene PATCH got wrong, so they
 * are written as "what would have been lost" rather than as unit trivia.
 */

const element = (id: string, extra: Partial<SyncElement> = {}): SyncElement => ({
  id, version: 1, versionNonce: 100, index: "a1", ...extra,
});

const sharedOf = (...elements: SyncElement[]) =>
  new Map(elements.map((item) => [item.id, item] as const));

describe("whiteboard sync rules", () => {
  it("takes the element with more mutations behind it, not the later writer", () => {
    const older = element("rect", { version: 4 });
    const newer = element("rect", { version: 5 });
    expect(isNewer(newer, older)).toBe(true);
    // The case Yjs alone gets wrong: a peer still holding v4 writes after the
    // v5 write lands. Order of arrival says v4 wins; version says it must not.
    expect(isNewer(older, newer)).toBe(false);
  });

  it("settles a true simultaneous edit the same way on every peer", () => {
    const mine = element("rect", { version: 7, versionNonce: 10 });
    const theirs = element("rect", { version: 7, versionNonce: 20 });
    // Same version, so neither contains more edits: the nonce decides, and it
    // decides identically wherever it is evaluated — which is what stops two
    // clients overwriting each other forever.
    expect(isNewer(mine, theirs)).toBe(true);
    expect(isNewer(theirs, mine)).toBe(false);
    // The same mutation seen twice is not a change, so it writes nothing.
    expect(isNewer(mine, mine)).toBe(false);
  });

  it("writes only what this client changed, leaving a peer's new shape alone", () => {
    const shared = sharedOf(element("mine", { version: 1 }), element("peer", { version: 3 }));
    // Local scene has not painted `peer` yet — the arriving update is in flight.
    const local = [element("mine", { version: 2 })];

    const { upserts, removals } = localChanges(local, shared, new Set(["mine"]));
    expect(upserts.map((item) => item.id)).toEqual(["mine"]);
    // The bug this whole slice exists to kill: publishing "my scene" as the
    // scene, which deletes the shape the other person just drew.
    expect(removals).toEqual([]);
  });

  it("claims a deletion only for an element it had actually painted", () => {
    const shared = sharedOf(element("keep"), element("gone"), element("unseen"));
    const { upserts, removals } = localChanges(
      [element("keep")], shared, new Set(["keep", "gone"])
    );
    // `gone` was on screen and is not any more: a member erased it, and that has
    // to propagate or erasing would only ever be local. `unseen` is absent for
    // the innocent reason — it has not arrived here yet.
    expect(removals).toEqual(["gone"]);
    expect(upserts).toEqual([]);
  });

  it("orders the scene by fractional index so every peer paints one z-order", () => {
    const shared = sharedOf(
      element("top", { index: "a3" }),
      element("bottom", { index: "a1" }),
      element("middle", { index: "a2" }),
    );
    expect(sceneFromShared(shared).map((item) => item.id)).toEqual(["bottom", "middle", "top"]);
  });

  it("breaks an index tie by id, and drops tombstones", () => {
    const shared = sharedOf(
      element("b", { index: "a1" }),
      element("a", { index: "a1" }),
      element("erased", { index: "a0", isDeleted: true }),
    );
    // Two elements inserted concurrently can share an index; without a stable
    // tie-break the two peers would render the stack in opposite orders.
    expect(sceneFromShared(shared).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("repaints only when the visible scene actually moved", () => {
    const current = [element("a", { version: 2 }), element("b")];
    expect(sceneDiffers([element("a", { version: 2 }), element("b")], current)).toBe(false);
    // A mutation of an existing shape, a new shape, and a reorder each change
    // what is on screen; an echo of our own write does not, and repainting on
    // one would interrupt the gesture the local user is mid-way through.
    expect(sceneDiffers([element("a", { version: 3 }), element("b")], current)).toBe(true);
    expect(sceneDiffers([element("a", { version: 2 })], current)).toBe(true);
    expect(sceneDiffers([element("b"), element("a", { version: 2 })], current)).toBe(true);
  });
});
