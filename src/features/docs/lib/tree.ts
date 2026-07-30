import type { Doc } from "../types";

/**
 * The doc hierarchy (056 stored `parent_id` and `position` from the start; the
 * dialog rendered a flat list). Building the tree is pure and client-side: the
 * workspace read already returns every doc, so nesting is a shape over an array
 * we hold, not N more requests.
 *
 * Two properties the UI depends on and this module guarantees:
 * - **Every doc appears exactly once.** A doc whose parent is missing from the
 *   set — filtered out by a search term, or deleted mid-session — is shown as a
 *   root rather than dropped, because a page you cannot see is worse than a page
 *   at the wrong depth.
 * - **A cycle cannot hang the render.** The server refuses to create one, but a
 *   client is not the place to trust that: anything unreachable from a root
 *   after the walk is promoted to a root, so the recursion always terminates.
 */
export interface DocTreeNode {
  doc: Doc;
  /** 0 for a root; each level of nesting adds one. */
  depth: number;
  children: DocTreeNode[];
}

/** Siblings read in their stored order, id as the stable tiebreak. */
function bySiblingOrder(a: Doc, b: Doc): number {
  return a.position - b.position || a.id - b.id;
}

export function buildDocTree(docs: Doc[]): DocTreeNode[] {
  const present = new Set(docs.map((d) => d.id));
  const childrenOf = new Map<number, Doc[]>();
  const roots: Doc[] = [];

  for (const doc of docs) {
    // A parent outside the visible set makes this doc a root (see above).
    if (doc.parentId === null || !present.has(doc.parentId)) {
      roots.push(doc);
      continue;
    }
    const siblings = childrenOf.get(doc.parentId);
    if (siblings) siblings.push(doc);
    else childrenOf.set(doc.parentId, [doc]);
  }

  const placed = new Set<number>();
  function nodesFor(parents: Doc[], depth: number): DocTreeNode[] {
    const nodes: DocTreeNode[] = [];
    for (const doc of [...parents].sort(bySiblingOrder)) {
      // Checked one doc at a time, not filtered up front: a sibling can be
      // placed by the recursion into an earlier one (that is what a cycle looks
      // like from here), and the check has to see that.
      if (placed.has(doc.id)) continue;
      placed.add(doc.id);
      nodes.push({
        doc,
        depth,
        children: nodesFor(childrenOf.get(doc.id) ?? [], depth + 1),
      });
    }
    return nodes;
  }

  const tree = nodesFor(roots, 0);
  // Anything left is in a parent cycle: surface it as a root so it stays
  // reachable and editable — a user can only break the cycle from the UI.
  const orphans = docs.filter((d) => !placed.has(d.id));
  return orphans.length === 0 ? tree : [...tree, ...nodesFor(orphans, 0)];
}

/** Depth-first, parent before child — the order a sidebar renders. */
export function flattenDocTree(nodes: DocTreeNode[]): DocTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenDocTree(node.children)]);
}

/**
 * Every doc under `id`, excluding `id` itself. Used to keep a parent picker from
 * offering a move that would make a doc its own ancestor — the same rule the
 * server enforces, applied early so the illegal option is never shown.
 */
export function descendantIds(docs: Doc[], id: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const doc of docs) {
    if (doc.parentId === null) continue;
    const siblings = childrenOf.get(doc.parentId);
    if (siblings) siblings.push(doc.id);
    else childrenOf.set(doc.parentId, [doc.id]);
  }
  const found = new Set<number>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    // The guard doubles as cycle protection: a doc already seen is not walked
    // again, so a corrupt chain terminates instead of spinning.
    if (next === id || found.has(next)) continue;
    found.add(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return found;
}
