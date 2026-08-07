"use client";

import "@excalidraw/excalidraw/index.css";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { localChanges, sceneDiffers, sceneFromShared, type SyncElement } from "../lib/sync";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((module) => module.Excalidraw), { ssr: false });

type SceneApi = { updateScene: (scene: { elements: readonly unknown[] }) => void };

/** What the parent can do to a canvas it does not own the state of. */
export type CanvasHandle = { add: (elements: SyncElement[]) => void };

/**
 * The canvas, and the whole of the whiteboard's realtime story (088).
 *
 * Elements live in a Y.Map keyed by element id — see lib/sync.ts for why that
 * shape rather than a Y.Array of the scene — and the flow is deliberately
 * one-directional in each leg:
 *
 *   local gesture → onChange → write only the elements this client actually
 *                   changed (version-guarded) into the map
 *   remote update → observe → repaint through updateScene, never through React
 *                   state, so a peer's stroke cannot remount Excalidraw and drop
 *                   the gesture the local user is in the middle of
 *
 * When no socket is available — no realtime process, ticket refused, network
 * gone — `onScene` still fires with `live: false` and the parent keeps the
 * debounced PATCH that shipped with 060. That fallback is the single-writer
 * behaviour this component exists to replace, and it stays because a deployment
 * without the realtime service is supported, not because it is good.
 */
export function WhiteboardCanvas({
  whiteboardId,
  initialScene,
  canEdit,
  onScene,
  onReady,
}: {
  whiteboardId: number;
  initialScene: SyncElement[];
  canEdit: boolean;
  onScene: (scene: SyncElement[], live: boolean) => void;
  onReady?: (handle: CanvasHandle) => void;
}) {
  const apiRef = useRef<SceneApi | null>(null);
  const sharedRef = useRef<Y.Map<SyncElement> | null>(null);
  const paintedRef = useRef<SyncElement[]>(initialScene);
  const onSceneRef = useRef(onScene);
  const onReadyRef = useRef(onReady);
  // The latest-callback refs are refreshed in an effect, not during render: the
  // socket effect must not depend on a parent's inline arrow identity, or every
  // parent re-render would drop the connection.
  useEffect(() => { onSceneRef.current = onScene; onReadyRef.current = onReady; });
  // Which ids this client has actually had on screen — the difference between
  // "you erased that" and "I have not painted your new shape yet". See
  // localChanges: absence alone cannot tell those apart.
  const seenRef = useRef<Set<string>>(new Set(initialScene.map((element) => element.id)));
  // The seed is captured once per mount, so a parent that hands back a fresh
  // array on re-render cannot tear down and rebuild the socket mid-stroke.
  // Replacing the scene from outside is a remount (the parent's `sceneKey`).
  const [seed] = useState(initialScene);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    let stopped = false;
    const ydoc = new Y.Doc();
    const shared = ydoc.getMap<SyncElement>("elements");
    let provider: WebsocketProvider | undefined;

    // Repaint from the shared map. Skipped when nothing observable changed:
    // updateScene is what interrupts a local pointer gesture, so it must not
    // fire for an update that adds no information (our own echo, presence, a
    // peer re-sending an element at the same version).
    const repaint = () => {
      const next = sceneFromShared(shared);
      if (!sceneDiffers(next, paintedRef.current)) return;
      paintedRef.current = next;
      for (const element of next) seenRef.current.add(element.id);
      apiRef.current?.updateScene({ elements: next });
      onSceneRef.current(next, true);
    };

    void fetch(`/api/whiteboards/${whiteboardId}/collaboration-ticket`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok || stopped) return;
        const { ticket } = (await response.json()) as { ticket: string };
        const endpoint = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
        provider = new WebsocketProvider(endpoint, `wb-${whiteboardId}`, ydoc, { params: { ticket } });
        sharedRef.current = shared;
        shared.observe(repaint);
        // The room's state is authoritative once it arrives, but a canvas whose
        // room has never been opened arrives empty — seed it from the scene the
        // server already has rather than publishing an empty canvas over it.
        provider.on("sync", (synced: boolean) => {
          if (!synced || stopped) return;
          if (shared.size === 0 && seed.length > 0) {
            ydoc.transact(() => { for (const element of seed) shared.set(element.id, structuredClone(element)); });
          }
          setLive(true);
          repaint();
        });
        provider.on("status", ({ status }: { status: string }) => { if (status === "disconnected") setLive(false); });
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      setLive(false);
      sharedRef.current = null;
      shared.unobserve(repaint);
      provider?.destroy();
      ydoc.destroy();
    };
  }, [whiteboardId, canEdit, seed]);

  /**
   * Excalidraw fires onChange for every scene mutation, including each pointer
   * move while drawing. Writing the *changed* elements (not the scene) keeps
   * that cheap and, more importantly, correct: a peer's shape that this client
   * has not yet painted survives our write, where publishing our whole scene
   * would delete it.
   */
  const handleChange = useCallback((elements: readonly SyncElement[]) => {
    const shared = sharedRef.current;
    if (!shared) {
      paintedRef.current = [...elements];
      for (const element of elements) seenRef.current.add(element.id);
      onSceneRef.current([...elements], false);
      return;
    }
    const { upserts, removals } = localChanges(elements, shared, seenRef.current);
    if (upserts.length === 0 && removals.length === 0) return;
    // Snapshot, never the live object: Excalidraw mutates elements in place as a
    // gesture continues, so storing its object writes the pointer-down state to
    // the room and then leaves the map holding the very object whose `version`
    // isNewer compares against — every later mutation compares the element with
    // itself and is never written.
    shared.doc?.transact(() => {
      for (const element of upserts) shared.set(element.id, structuredClone(element));
      for (const id of removals) shared.delete(id);
    });
    for (const element of elements) seenRef.current.add(element.id);
    for (const id of removals) seenRef.current.delete(id);
    paintedRef.current = sceneFromShared(shared);
    onSceneRef.current(paintedRef.current, true);
  }, []);

  /**
   * Elements the parent mints (the task-card button). It has to come through
   * here rather than through a remount with a new seed: the seed is only used
   * for a room nobody has opened, so a remount mid-session would paint the card
   * locally and then have it wiped by the room's own state on the next sync.
   */
  const add = useCallback((elements: SyncElement[]) => {
    const shared = sharedRef.current;
    if (shared) {
      shared.doc?.transact(() => { for (const element of elements) shared.set(element.id, structuredClone(element)); });
      for (const element of elements) seenRef.current.add(element.id);
      paintedRef.current = sceneFromShared(shared);
      apiRef.current?.updateScene({ elements: paintedRef.current });
      onSceneRef.current(paintedRef.current, true);
      return;
    }
    const next = [...paintedRef.current, ...elements];
    paintedRef.current = next;
    for (const element of elements) seenRef.current.add(element.id);
    apiRef.current?.updateScene({ elements: next });
    onSceneRef.current(next, false);
  }, []);
  useEffect(() => { onReadyRef.current?.({ add }); }, [add]);

  return (
    <>
      <div className="h-[32rem] overflow-hidden rounded border">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api as unknown as SceneApi; }}
          initialData={{ elements: seed as never[] }}
          viewModeEnabled={!canEdit}
          onChange={(elements) => { if (canEdit) handleChange(elements as unknown as SyncElement[]); }}
        />
      </div>
      {/* Said out loud, because the two modes have genuinely different rules: in
          one, a collaborator's shapes merge with yours; in the other, the last
          save of the two wins. A user about to draw with someone deserves to
          know which one they are in. */}
      {canEdit && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="whiteboard-connection">
          {live ? "Live — everyone in this canvas sees your strokes" : "Saving to the server — open the realtime service to draw together"}
        </p>
      )}
    </>
  );
}
