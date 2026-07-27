// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskExtensionPanels } from "./task-extension-panels";

/**
 * The postMessage bridge is the security boundary between third-party iframes
 * and the session: any window can post to the parent, so the origin *and* the
 * contentWindow identity checks are what keep a hostile frame (or a hostile
 * tab) from reading tasks through someone else's granted extension. These tests
 * drive the real listener with forged and genuine MessageEvents.
 */

const EXTENSION_ORIGIN = "https://ext.example.test";

const extension = {
  id: 7,
  workspaceId: "ws-1",
  name: "example.panel",
  url: `${EXTENSION_ORIGIN}/panel`,
  capabilities: ["task.read"],
  slots: ["task_panel"],
  installedBy: "u-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const taskPayload = { task: { id: 1, title: "Bridged", description: "", dueDate: null, startDate: null } };

const fetchMock = vi.fn();

function bridgeCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/bridge"));
}

async function renderPanel() {
  render(<TaskExtensionPanels taskId={1} />);
  const iframe = (await screen.findByTitle("example.panel")) as HTMLIFrameElement;
  return iframe;
}

const request = { type: "kanban.extension.request", method: "task.read", requestId: "r-1" };

function deliver(origin: string, source: Window | null, data: unknown = request) {
  window.dispatchEvent(new MessageEvent("message", { origin, source, data }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/bridge")) return Response.json(taskPayload);
    return Response.json([extension]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("TaskExtensionPanels postMessage bridge", () => {
  it("sandboxes the iframe and never grants same-origin", async () => {
    const iframe = await renderPanel();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.src).toBe(`${EXTENSION_ORIGIN}/panel`);
  });

  it("answers a request from the extension's own frame and origin", async () => {
    const iframe = await renderPanel();
    const frameWindow = iframe.contentWindow!;
    const posted = vi.spyOn(frameWindow, "postMessage");

    deliver(EXTENSION_ORIGIN, frameWindow);

    await waitFor(() => expect(bridgeCalls()).toHaveLength(1));
    // The capability the iframe asked for becomes the bridge's scope; nothing
    // else the message carried is forwarded.
    expect(String(bridgeCalls()[0][0])).toBe(
      "/api/tasks/1/extensions/7/bridge?scope=task"
    );
    await waitFor(() =>
      expect(posted).toHaveBeenCalledWith(
        {
          type: "kanban.extension.response",
          requestId: "r-1",
          ok: true,
          body: taskPayload,
        },
        EXTENSION_ORIGIN
      )
    );
  });

  it("ignores a message from the wrong origin, even from the right window", async () => {
    // A compromised redirect inside the iframe changes its origin; the stored
    // contentWindow still matches, so origin is the check doing the work here.
    const iframe = await renderPanel();
    const frameWindow = iframe.contentWindow!;
    const posted = vi.spyOn(frameWindow, "postMessage");

    deliver("https://evil.example.test", frameWindow);
    await flush();

    expect(bridgeCalls()).toHaveLength(0);
    expect(posted).not.toHaveBeenCalled();
  });

  it("ignores a message claiming the right origin from the wrong window", async () => {
    // Another tab/window can lie about nothing — the browser stamps source —
    // so a request not originating from the tracked iframe must be dropped.
    const iframe = await renderPanel();
    const posted = vi.spyOn(iframe.contentWindow!, "postMessage");

    deliver(EXTENSION_ORIGIN, window); // the parent window itself, not the frame
    deliver(EXTENSION_ORIGIN, null);
    await flush();

    expect(bridgeCalls()).toHaveLength(0);
    expect(posted).not.toHaveBeenCalled();
  });

  it("ignores well-placed messages asking for a capability that does not exist", async () => {
    const iframe = await renderPanel();
    const frameWindow = iframe.contentWindow!;

    // task.write is not in the vocabulary at all — the capability set is
    // read-only by construction, so there is nothing to map it onto.
    deliver(EXTENSION_ORIGIN, frameWindow, { ...request, method: "task.write" });
    deliver(EXTENSION_ORIGIN, frameWindow, { ...request, method: "comments" });
    deliver(EXTENSION_ORIGIN, frameWindow, { ...request, type: "other" });
    deliver(EXTENSION_ORIGIN, frameWindow, { ...request, requestId: 42 });
    deliver(EXTENSION_ORIGIN, frameWindow, "just-a-string");
    await flush();

    expect(bridgeCalls()).toHaveLength(0);
  });

  it("relays a bridge refusal as ok:false rather than leaking nothing back", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/bridge"))
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      return Response.json([extension]);
    });
    const iframe = await renderPanel();
    const frameWindow = iframe.contentWindow!;
    const posted = vi.spyOn(frameWindow, "postMessage");

    deliver(EXTENSION_ORIGIN, frameWindow);

    await waitFor(() =>
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({ type: "kanban.extension.response", ok: false }),
        EXTENSION_ORIGIN
      )
    );
  });

  it("renders nothing at all when no extension is installed for the slot", async () => {
    fetchMock.mockImplementation(async () => Response.json([]));
    const { container } = render(<TaskExtensionPanels taskId={2} />);
    await flush();
    expect(container.innerHTML).toBe("");
  });
});
