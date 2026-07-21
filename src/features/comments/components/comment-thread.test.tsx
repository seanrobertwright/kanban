// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommentThread } from "./comment-thread";
import type { CommentEntry } from "../types";

vi.mock("../client/api", () => ({
  fetchTaskComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  resolveComment: vi.fn(),
}));
const api = await import("../client/api");

function comment(over: Partial<CommentEntry> = {}): CommentEntry {
  return {
    id: 1,
    taskId: 7,
    authorType: "human",
    authorId: "user-1",
    authorName: "Alice",
    authorImage: null,
    body: "Looks good to me",
    createdAt: new Date().toISOString(),
    updatedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    parentId: null,
    canEdit: false,
    canDelete: false,
    canResolve: false,
    ...over,
  };
}

async function renderThread(comments: CommentEntry[], onChanged = vi.fn()) {
  vi.mocked(api.fetchTaskComments).mockResolvedValue(comments);
  render(<CommentThread taskId={7} onChanged={onChanged} />);
  // The thread fetches on mount, so every assertion waits for the first paint.
  await screen.findByLabelText("New comment");
  return onChanged;
}

describe("CommentThread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a comment and its author", async () => {
    await renderThread([comment()]);
    expect(screen.getByText("Looks good to me")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("says so when a task has no comments", async () => {
    await renderThread([]);
    expect(screen.getByText("No comments yet.")).toBeDefined();
  });

  it("keeps a comment whose author has been deleted", async () => {
    // author_id has no FK precisely so the row survives; dropping it from the UI
    // would undo that at the last step.
    await renderThread([comment({ authorName: null })]);
    expect(screen.getByText("A removed user")).toBeDefined();
    expect(screen.getByText("Looks good to me")).toBeDefined();
  });

  it("labels an agent author as one", async () => {
    // M2 writes these rows. The type is what tells them apart, not the name.
    await renderThread([
      comment({ authorType: "agent", authorId: "agent-1", authorName: null }),
    ]);
    expect(screen.getByText("An agent")).toBeDefined();
  });

  it("marks an edited comment as edited, and an untouched one not", async () => {
    await renderThread([
      comment({ id: 1, body: "Edited one", updatedAt: new Date().toISOString() }),
      comment({ id: 2, body: "Untouched one", updatedAt: null }),
    ]);
    expect(screen.getAllByText(/edited/)).toHaveLength(1);
  });

  it("renders the body as text, never as markup", async () => {
    // An agent writes here from M2 and its output is not to be trusted with
    // HTML. React escapes by default — this test is here so that a later
    // "render markdown" change has to break something to land.
    await renderThread([comment({ body: "<img src=x onerror=alert(1)>" })]);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeDefined();
    expect(document.querySelector("img")).toBeNull();
  });

  describe("posting", () => {
    it("posts a comment and clears the box", async () => {
      vi.mocked(api.createComment).mockResolvedValue({} as never);
      await renderThread([]);

      const box = screen.getByLabelText("New comment");
      fireEvent.change(box, { target: { value: "New remark" } });
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));

      await waitFor(() =>
        expect(api.createComment).toHaveBeenCalledWith(7, "New remark")
      );
      await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
    });

    it("refuses to post an empty or whitespace-only comment", async () => {
      await renderThread([]);
      const button = screen.getByRole("button", { name: "Comment" });
      expect((button as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(screen.getByLabelText("New comment"), {
        target: { value: "   " },
      });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(api.createComment).not.toHaveBeenCalled();
    });

    it("tells the history something happened", async () => {
      // Every comment mutation writes an activity_log row. Without this nudge
      // the feed below would go on insisting nothing happened.
      vi.mocked(api.createComment).mockResolvedValue({} as never);
      const onChanged = await renderThread([]);

      fireEvent.change(screen.getByLabelText("New comment"), {
        target: { value: "Ping" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));

      await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it("surfaces a failure instead of pretending it posted", async () => {
      vi.mocked(api.createComment).mockRejectedValue(new Error("Nope"));
      await renderThread([]);

      fireEvent.change(screen.getByLabelText("New comment"), {
        target: { value: "Doomed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));

      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Nope"
      );
    });
  });

  describe("what the UI offers", () => {
    it("offers no edit or delete on someone else's comment", async () => {
      // The server decides this; the component only draws what it is told.
      await renderThread([comment({ canEdit: false, canDelete: false })]);
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });

    it("offers delete but not edit to an admin", async () => {
      // The line the repository draws: an admin may remove a remark, never
      // rewrite one.
      await renderThread([comment({ canEdit: false, canDelete: true })]);
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
    });

    it("offers both to the author", async () => {
      await renderThread([comment({ canEdit: true, canDelete: true })]);
      expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
    });
  });

  describe("editing", () => {
    it("edits a comment in place", async () => {
      vi.mocked(api.updateComment).mockResolvedValue({} as never);
      await renderThread([comment({ id: 3, canEdit: true })]);

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const box = screen.getByLabelText("Edit comment");
      // The box opens holding the current text, not empty — an edit is a
      // revision, and retyping from scratch is not one.
      expect((box as HTMLTextAreaElement).value).toBe("Looks good to me");

      fireEvent.change(box, { target: { value: "Actually, one nit" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(api.updateComment).toHaveBeenCalledWith(3, "Actually, one nit")
      );
    });

    it("abandons an edit without saving it", async () => {
      await renderThread([comment({ canEdit: true })]);

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Edit comment"), {
        target: { value: "Never mind" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(api.updateComment).not.toHaveBeenCalled();
      expect(screen.getByText("Looks good to me")).toBeDefined();
    });
  });

  describe("deleting", () => {
    it("takes two clicks, so a slip is not a lost remark", async () => {
      vi.mocked(api.deleteComment).mockResolvedValue(undefined);
      await renderThread([comment({ id: 4, canDelete: true })]);

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(api.deleteComment).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Really?" }));
      await waitFor(() => expect(api.deleteComment).toHaveBeenCalledWith(4));
    });
  });
});
