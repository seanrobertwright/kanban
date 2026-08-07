// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";

import { WhiteboardCanvas, type CanvasHandle } from "./whiteboard-canvas";
import type { SyncElement } from "../lib/sync";

/**
 * The glue between Excalidraw and the shared map — the part lib/sync.ts's rules
 * cannot cover, because what can go wrong here is not a rule but a wire: writing
 * a PATCH while a room is already persisting (two writers again), or never
 * repainting what a peer drew (a merge nobody can see). Both look perfectly
 * healthy on screen, so these cases watch the callbacks, not the canvas.
 */

// The real editor is a canvas with no test surface; this stub is a button that
// reports a scene, which is the only interaction the component actually has.
let sceneToReport: SyncElement[] = [];
const updateScene = vi.fn();
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({ excalidrawAPI, onChange }: {
    excalidrawAPI?: (api: unknown) => void;
    onChange?: (elements: readonly SyncElement[]) => void;
  }) => {
    excalidrawAPI?.({ updateScene });
    return <button onClick={() => onChange?.(sceneToReport)}>draw</button>;
  },
}));

// A provider that connects when the test says so, so "live" and "offline" are
// both reachable without a socket.
type Fake = { ydoc: Y.Doc; sync: (value: boolean) => void; destroyed: boolean };
let provider: Fake | null = null;
vi.mock("y-websocket", () => ({
  WebsocketProvider: class {
    private handlers = new Map<string, (value: never) => void>();
    constructor(_endpoint: string, _room: string, ydoc: Y.Doc) {
      provider = {
        ydoc,
        sync: (value: boolean) => this.handlers.get("sync")?.(value as never),
        destroyed: false,
      };
    }
    on(event: string, handler: (value: never) => void) { this.handlers.set(event, handler); }
    destroy() { if (provider) provider.destroyed = true; }
  },
}));

const element = (id: string, version = 1): SyncElement => ({ id, version, versionNonce: 5, index: "a1" });

/** Mounts the canvas and waits for the lazily imported editor to appear. */
async function mount(options: { ticket: boolean; initial?: SyncElement[] }) {
  const onScene = vi.fn();
  let handle: CanvasHandle | null = null;
  vi.stubGlobal("fetch", vi.fn(async () =>
    options.ticket
      ? ({ ok: true, json: async () => ({ ticket: "signed" }) } as Response)
      : ({ ok: false, json: async () => ({}) } as Response)
  ));
  render(
    <WhiteboardCanvas
      whiteboardId={3}
      initialScene={options.initial ?? []}
      canEdit
      onScene={onScene}
      onReady={(value) => { handle = value; }}
    />
  );
  await screen.findByText("draw");
  return { onScene, handle: () => handle! };
}

describe("WhiteboardCanvas", () => {
  beforeEach(() => { sceneToReport = []; provider = null; updateScene.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reports scenes as not live until a room is holding them", async () => {
    const { onScene } = await mount({ ticket: false });
    sceneToReport = [element("solo")];
    fireEvent.click(screen.getByText("draw"));

    // `live: false` is the parent's cue to keep the debounced PATCH: with no
    // room, that fallback is the only thing saving the canvas.
    await waitFor(() => expect(onScene).toHaveBeenCalledWith([element("solo")], false));
    expect(screen.getByTestId("whiteboard-connection").textContent).toMatch(/Saving to the server/);
  });

  it("stops reporting for the parent to save once the room is live", async () => {
    const { onScene } = await mount({ ticket: true });
    await waitFor(() => expect(provider).not.toBeNull());
    provider!.sync(true);
    await waitFor(() => expect(screen.getByTestId("whiteboard-connection").textContent).toMatch(/^Live/));

    sceneToReport = [element("drawn")];
    fireEvent.click(screen.getByText("draw"));

    // Same stroke, other answer: the room persists it, and a PATCH on top would
    // write the whole scene over whatever a collaborator changed meanwhile —
    // the exact clobber 088 exists to remove.
    await waitFor(() => expect(onScene).toHaveBeenCalledWith([element("drawn")], true));
    expect(onScene.mock.calls.every(([, live]) => live === true)).toBe(true);
    // And the stroke is in the shared document, not merely in local state.
    expect(provider!.ydoc.getMap("elements").get("drawn")).toEqual(element("drawn"));
  });

  it("stores a snapshot, so in-place mutation of the live element still syncs", async () => {
    const { onScene } = await mount({ ticket: true });
    await waitFor(() => expect(provider).not.toBeNull());
    provider!.sync(true);

    // Excalidraw mutates the same element object for the whole gesture. If the
    // map holds that object, the pointer-down state is what got encoded, and
    // every later version compares against itself — never written again.
    const live = element("stroke");
    sceneToReport = [live];
    fireEvent.click(screen.getByText("draw"));
    await waitFor(() => expect(onScene).toHaveBeenCalled());
    expect(provider!.ydoc.getMap("elements").get("stroke")).not.toBe(live);

    live.version = 2;
    live.width = 100;
    fireEvent.click(screen.getByText("draw"));
    await waitFor(() =>
      expect(provider!.ydoc.getMap<SyncElement>("elements").get("stroke")).toEqual({ ...element("stroke", 2), width: 100 })
    );
  });

  it("paints what a peer draws without being asked to re-render", async () => {
    const { onScene } = await mount({ ticket: true });
    await waitFor(() => expect(provider).not.toBeNull());
    provider!.sync(true);

    // A peer's write arrives on the shared map, which is the only channel a
    // remote stroke has: no props change, so a component that repainted only
    // from React state would show nothing at all.
    provider!.ydoc.getMap<SyncElement>("elements").set("theirs", element("theirs"));
    await waitFor(() => expect(updateScene).toHaveBeenCalledWith({ elements: [element("theirs")] }));
    expect(onScene).toHaveBeenCalledWith([element("theirs")], true);
  });

  it("seeds an empty room from the scene the server already had", async () => {
    const initial = [element("existing")];
    await mount({ ticket: true, initial });
    await waitFor(() => expect(provider).not.toBeNull());
    provider!.sync(true);

    // A canvas whose room has never been opened arrives empty. Publishing that
    // emptiness would erase every shape drawn before realtime existed.
    await waitFor(() => expect(provider!.ydoc.getMap("elements").get("existing")).toEqual(element("existing")));
  });

  it("adds a parent-minted element into the live room", async () => {
    const { handle, onScene } = await mount({ ticket: true });
    await waitFor(() => expect(provider).not.toBeNull());
    provider!.sync(true);

    // The task-card button. It goes through the room rather than a remount,
    // because a remount would reseed — and a live room ignores its seed.
    handle().add([element("task-card")]);
    expect(provider!.ydoc.getMap("elements").get("task-card")).toEqual(element("task-card"));
    expect(updateScene).toHaveBeenCalledWith({ elements: [element("task-card")] });
    expect(onScene).toHaveBeenLastCalledWith([element("task-card")], true);
  });
});
