/**
 * The reconciliation rules a shared canvas needs, kept out of the component so
 * they can be tested without a browser, a socket or Excalidraw.
 *
 * A whiteboard is synced as a Y.Map keyed by element id, not a Y.Array of the
 * scene: two people dragging two different shapes touch two different keys and
 * merge with no conflict at all, where an array of the whole scene makes every
 * edit a conflict with every other edit. What a Map gives up is order, and
 * z-order is meaning on a canvas — so ordering is recovered from Excalidraw's
 * own fractional `index` (a sortable string, "a1" < "a2"), which every element
 * carries since 0.18. That is the same trade upstream Excalidraw's multiplayer
 * makes, and the reason this file exists rather than a `scene` register.
 */

/** As much of an Excalidraw element as syncing cares about. */
export type SyncElement = {
  id: string;
  version?: number;
  versionNonce?: number;
  index?: string | null;
  isDeleted?: boolean;
  [key: string]: unknown;
};

/**
 * The read side of the shared map, as a structural type rather than
 * `ReadonlyMap`: a `Y.Map` is exactly this and is not assignable to a
 * `ReadonlyMap` (its iterators predate the ES2024 iterator helpers). Typing the
 * hole this way is what lets these rules be tested against a plain `Map` and run
 * against a `Y.Map` with no copying in between.
 */
export type SharedElements = {
  get(id: string): SyncElement | undefined;
  keys(): IterableIterator<string>;
  values(): IterableIterator<SyncElement>;
};

/**
 * Excalidraw's own tie-break, and it matters that it is not "last write wins":
 * Yjs would happily let a peer whose clock/ordering came second overwrite a
 * *newer* element with an older copy it was still holding. `version` counts
 * mutations, so a higher one strictly contains more edits; `versionNonce` is a
 * random per-mutation number that settles genuine simultaneity the same way on
 * every peer, which is what stops two clients from ping-ponging forever.
 */
export function isNewer(incoming: SyncElement, existing: SyncElement | undefined): boolean {
  if (!existing) return true;
  const a = incoming.version ?? 0;
  const b = existing.version ?? 0;
  if (a !== b) return a > b;
  const nonceA = incoming.versionNonce ?? 0;
  const nonceB = existing.versionNonce ?? 0;
  // Equal versions with equal nonces are the same mutation — not a change.
  return nonceA < nonceB;
}

/**
 * What this client must write for its local scene to be represented in the
 * shared map. Deliberately *not* a full replace: an element the local client
 * has never heard of (a peer's brand-new shape, arriving between two of our own
 * strokes) must survive our write, which a "send my whole scene" model destroys.
 *
 * That is also why a removal cannot be inferred from absence alone. "In the
 * shared map, missing from my scene" describes two opposite events — I erased
 * it, or you just drew it and I have not painted you yet — and guessing wrong
 * in the second case deletes a stranger's shape as they draw it. `seen` is the
 * set of ids this client has actually rendered, which tells the two apart: only
 * something I had and no longer have was erased by me.
 */
export function localChanges(
  local: readonly SyncElement[],
  shared: SharedElements,
  seen: ReadonlySet<string>
): { upserts: SyncElement[]; removals: string[] } {
  const upserts = local.filter((element) => isNewer(element, shared.get(element.id)));
  const localIds = new Set(local.map((element) => element.id));
  const removals = [...shared.keys()].filter((id) => !localIds.has(id) && seen.has(id));
  return { upserts, removals };
}

/**
 * The shared map rendered back as a scene. Sorted by fractional index with the
 * id as the tie-break, so every peer paints the same z-order from the same map
 * even when two elements were inserted concurrently at the same index.
 * Tombstones (`isDeleted`) are dropped: Excalidraw keeps them for its own undo
 * history, but a peer has no use for another session's undo stack.
 */
export function sceneFromShared(shared: SharedElements): SyncElement[] {
  return [...shared.values()]
    .filter((element) => !element.isDeleted)
    .sort((a, b) => {
      const indexA = a.index ?? "";
      const indexB = b.index ?? "";
      return indexA === indexB ? a.id.localeCompare(b.id) : indexA < indexB ? -1 : 1;
    });
}

/**
 * Whether a repaint is worth doing. `updateScene` on every remote keystroke is
 * cheap in Excalidraw but not free, and — more to the point — it interrupts a
 * local pointer gesture, so it must not fire for an update that says nothing new
 * about what is on screen.
 */
export function sceneDiffers(next: readonly SyncElement[], current: readonly SyncElement[]): boolean {
  if (next.length !== current.length) return true;
  return next.some((element, position) => {
    const mine = current[position];
    return !mine || mine.id !== element.id || (mine.version ?? 0) !== (element.version ?? 0);
  });
}
