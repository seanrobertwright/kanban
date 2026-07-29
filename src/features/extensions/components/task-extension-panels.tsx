"use client";
import { useEffect, useRef, useState } from "react";

import { useExtensionCatalog } from "./extension-catalog";
import {
  scopeForCapability,
  type ExtensionSlot,
  type WorkspaceExtension,
} from "../types";

/** Iframes have no same-origin privileges and never receive session cookies from
 * the parent. The parent mediates a tiny, read-only postMessage bridge, tied to
 * both task and installed-extension IDs on the server.
 *
 * An iframe asks by capability name (`task.read`, `comments.read`, …); this
 * translates it to the bridge's scope and forwards nothing else. The check here
 * is a shape check, not a security boundary — a request for a capability the
 * manifest never asked for is refused by the server regardless, which is where
 * the grant actually lives. */
export function TaskExtensionPanels({
  taskId,
  slot = "task_panel",
  compact = false,
}: {
  taskId: number;
  slot?: ExtensionSlot;
  compact?: boolean;
}) {
  // Which extensions to render is a workspace-level question, so it comes from
  // the catalog when one is above us — a board mounts this once per card, and
  // asking the server per card meant N identical round trips for one answer.
  const catalog = useExtensionCatalog(slot);
  const [fetched, setFetched] = useState<WorkspaceExtension[]>([]);
  const extensions = catalog ?? fetched;
  const frames = useRef(new Map<number, HTMLIFrameElement>());

  useEffect(() => {
    // Only when rendered outside a catalog — a task panel opened somewhere that
    // has no board around it still has to be able to answer for itself.
    if (catalog) return;
    let cancelled = false;
    void fetch(`/api/tasks/${taskId}/extensions?slot=${slot}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: WorkspaceExtension[]) => {
        if (!cancelled) setFetched(items);
      })
      .catch(() => {
        if (!cancelled) setFetched([]);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, taskId, slot]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Both halves matter: the origin proves which extension is speaking, the
      // contentWindow identity proves the message came from the frame we
      // rendered rather than from any other window that can post here.
      const extension = extensions.find(
        (candidate) =>
          new URL(candidate.url).origin === event.origin &&
          frames.current.get(candidate.id)?.contentWindow === event.source
      );
      const data = event.data as {
        type?: string;
        requestId?: string;
        method?: string;
      };
      const scope = scopeForCapability(data?.method);
      if (
        !extension ||
        data?.type !== "kanban.extension.request" ||
        !scope ||
        typeof data.requestId !== "string"
      )
        return;
      void fetch(
        `/api/tasks/${taskId}/extensions/${extension.id}/bridge?scope=${scope}`,
        { cache: "no-store" }
      )
        .then(async (response) => ({
          ok: response.ok,
          body: await response.json().catch(() => null),
        }))
        // A refusal is relayed as ok:false rather than dropped: an extension
        // that hears nothing back cannot tell "denied" from "still loading".
        .then(({ ok, body }) =>
          frames.current
            .get(extension.id)
            ?.contentWindow?.postMessage(
              {
                type: "kanban.extension.response",
                requestId: data.requestId,
                ok,
                body,
              },
              event.origin
            )
        );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [extensions, taskId]);

  if (!extensions.length) return null;

  const body = (
    <>
      {extensions.map((extension) => (
        <iframe
          key={extension.id}
          ref={(node) => {
            if (node) frames.current.set(extension.id, node);
            else frames.current.delete(extension.id);
          }}
          title={extension.name}
          src={extension.url}
          sandbox="allow-scripts"
          className={
            compact ? "h-7 max-w-32 rounded border" : "min-h-24 w-full rounded-md border"
          }
        />
      ))}
    </>
  );

  return compact ? (
    <span className="flex gap-1">{body}</span>
  ) : (
    <section className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Extensions</p>
      {body}
    </section>
  );
}
