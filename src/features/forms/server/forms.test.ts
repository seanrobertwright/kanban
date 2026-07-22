import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { compileSubmission } from "../types";
import {
  createForm,
  deleteForm,
  FormSubmitError,
  listForms,
  submitForm,
  updateForm,
} from "./repository";

/**
 * The intake→task compile is pure and unit-tested; the rest is database fact —
 * the board scoping (a form only targets its own board's column), the submission
 * that creates a real task in the right column, and the closed/required guards —
 * which a mock could not stand in for (039).
 */

describe("compileSubmission (pure)", () => {
  const fields = [
    { label: "Summary", type: "text" as const, required: true },
    { label: "Details", type: "textarea" as const, required: false },
    { label: "Severity", type: "text" as const, required: false },
  ];

  it("takes the first answer as the title and compiles the rest", () => {
    const { title, description } = compileSubmission(fields, [
      "Login broken",
      "500 on submit",
      "high",
    ]);
    expect(title).toBe("Login broken");
    expect(description).toBe(
      "**Summary:** Login broken\n\n**Details:** 500 on submit\n\n**Severity:** high"
    );
  });

  it("skips unanswered optional fields", () => {
    const { title, description } = compileSubmission(fields, ["Only a title", "", ""]);
    expect(title).toBe("Only a title");
    expect(description).toBe("**Summary:** Only a title");
  });
});

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("forms", () => {
  let alice: string;
  let boardId: number;
  let firstColId: number;
  let secondColId: number;

  beforeAll(async () => {
    alice = await createUser("form-alice");
    await ensurePersonalWorkspace(alice, "FormAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    firstColId = cols[0].id;
    secondColId = cols[1].id;
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("creates and lists a form", async () => {
    const form = await createForm(alice, boardId, {
      name: "Bug report",
      description: "File a defect",
      targetColumnId: secondColId,
      fields: [
        { label: "Summary", type: "text", required: true },
        { label: "Steps", type: "textarea", required: false },
      ],
    });
    expect(form.name).toBe("Bug report");
    expect(form.fields).toHaveLength(2);
    expect(form.targetColumnId).toBe(secondColId);
    expect(form.isOpen).toBe(true);

    const forms = await listForms(alice, boardId);
    expect(forms.some((f) => f.id === form.id)).toBe(true);
  });

  it("submits into the target column and compiles the answers", async () => {
    const form = await createForm(alice, boardId, {
      name: "Feature request",
      targetColumnId: secondColId,
      fields: [
        { label: "Title", type: "text", required: true },
        { label: "Why", type: "textarea", required: false },
      ],
    });

    const task = await submitForm(alice, form.id, {
      answers: ["Dark mode", "It burns at night"],
    });
    expect(task.title).toBe("Dark mode");
    expect(task.columnId).toBe(secondColId);
    expect(task.description).toContain("**Why:** It burns at night");
  });

  it("falls back to the board's first column when untargeted", async () => {
    const form = await createForm(alice, boardId, {
      name: "Untargeted",
      fields: [{ label: "Title", type: "text", required: true }],
    });
    const task = await submitForm(alice, form.id, { answers: ["Lands up front"] });
    expect(task.columnId).toBe(firstColId);
  });

  it("refuses a closed form and a missing required answer", async () => {
    const form = await createForm(alice, boardId, {
      name: "Guarded",
      fields: [
        { label: "Title", type: "text", required: true },
        { label: "Owner", type: "text", required: true },
      ],
    });

    // Missing the required second answer.
    await expect(
      submitForm(alice, form.id, { answers: ["Has title", ""] })
    ).rejects.toBeInstanceOf(FormSubmitError);

    await updateForm(alice, form.id, { isOpen: false });
    await expect(
      submitForm(alice, form.id, { answers: ["Title", "Owner"] })
    ).rejects.toBeInstanceOf(FormSubmitError);
  });

  it("refuses targeting another board's column (not_found)", async () => {
    await expect(
      createForm(alice, boardId, {
        name: "Bad target",
        targetColumnId: 9_999_999,
        fields: [{ label: "Title", type: "text", required: true }],
      })
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("deletes a form", async () => {
    const form = await createForm(alice, boardId, {
      name: "Doomed",
      fields: [{ label: "Title", type: "text", required: true }],
    });
    expect(await deleteForm(alice, form.id)).toBe(true);
    const forms = await listForms(alice, boardId);
    expect(forms.some((f) => f.id === form.id)).toBe(false);
  });
});
