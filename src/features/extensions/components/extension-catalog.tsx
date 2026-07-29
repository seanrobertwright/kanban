"use client";
import { createContext, useContext, useMemo } from "react";

import type { ExtensionSlot, WorkspaceExtension } from "../types";

/**
 * One workspace's installed extensions, read once and shared by every slot on
 * the page.
 *
 * The list is workspace-scoped by definition (`workspace_extension` has no task
 * or board column), but the panel component originally read it through a
 * task-keyed endpoint — so a card badge rendered on 200 cards asked the server
 * 200 times for the same answer, usually the empty one, because a workspace
 * with no extensions installed still pays a request per card.
 *
 * The catalog is loaded server-side in `page.tsx` beside labels and members and
 * handed down, which is why the value here is a plain array rather than a
 * fetch-and-loading state: by the time a consumer mounts, it is already known.
 *
 * `undefined` means no provider is above the consumer at all — distinct from
 * "provider, zero extensions". A consumer must be able to tell those apart to
 * decide whether to fall back to fetching for itself.
 */
const ExtensionCatalogContext = createContext<WorkspaceExtension[] | undefined>(
  undefined
);

export function ExtensionCatalogProvider({
  extensions,
  children,
}: {
  extensions: WorkspaceExtension[];
  children: React.ReactNode;
}) {
  return (
    <ExtensionCatalogContext.Provider value={extensions}>
      {children}
    </ExtensionCatalogContext.Provider>
  );
}

/**
 * The extensions installed for one slot, or `undefined` when there is no
 * catalog above this component.
 *
 * Memoised on the identity of the whole list: the result is an effect
 * dependency in the panel component, and a fresh array each render would
 * re-arm the postMessage listener on every parent render.
 */
export function useExtensionCatalog(
  slot: ExtensionSlot
): WorkspaceExtension[] | undefined {
  const all = useContext(ExtensionCatalogContext);
  return useMemo(
    () => all?.filter((extension) => extension.slots.includes(slot)),
    [all, slot]
  );
}
