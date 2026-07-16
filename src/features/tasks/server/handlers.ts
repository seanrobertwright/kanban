import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { PRIORITY_ORDER, isTaskPriority } from "../types";
import type { TaskPriority } from "../types";
import {
  createTask,
  deleteTask,
  getTask,
  listSubtasks,
  moveTask,
  updateTask,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Task not found" }, { status: 404 });
}

/**
 * null is a legal value ("unassign"), undefined is its absence ("leave alone"),
 * and both must pass — which is why this is not the usual `typeof x === "string"`
 * guard. Whether the id names a real member of this workspace is not decided
 * here: that is a tenancy question, and it is answered in the repository next to
 * the RBAC checks, against the same transaction that does the write.
 */
function isAssigneeId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, or null ("no due date"), or absent ("leave it alone") — the
 * same three-valued shape as isAssigneeId, for the same reason.
 *
 * The shape check is not enough, and the round-trip below is the point:
 * "2026-02-30" and "2026-13-01" both match the regex and neither is a date.
 * Postgres would reject them — with a 22008 that surfaces as a 500, turning a
 * caller's typo into our error. Better to answer 400, which is the truth.
 *
 * Everything here is UTC — Date.UTC in, getUTC* out — even though the value is
 * zoneless. That is not confusion about what a date is: it is how the check
 * avoids introducing a zone. `new Date(2026, 1, 30)` would silently roll over to
 * March 2nd *in the server's local zone*, so the validity of a user's input
 * would depend on where the container happens to run. UTC is the one frame that
 * is the same everywhere, which makes it the right one to do zone-free
 * arithmetic in.
 */
/**
 * Two-valued, unlike isAssigneeId and isDueDate beside it: `[]` is the empty
 * set, so null is never a legal way to say "clear" and is rejected here rather
 * than honoured. 006's rule, holding for a third field.
 *
 * Whether these ids name labels of *this* workspace is not decided here — that
 * is a tenancy question, answered in the repository next to the RBAC checks,
 * against the same transaction that does the write.
 */
function isLabelIds(value: unknown): value is number[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((v) => Number.isInteger(v)))
  );
}

function isDueDate(value: unknown): value is string | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Round-trip: a rolled-over date disagrees with its own input on at least one
  // component. February 30th comes back as March 2nd and is caught here.
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export async function handleCreateTask(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const {
    columnId,
    title,
    description,
    assigneeId,
    priority,
    dueDate,
    labelIds,
    parentId,
  } = body as Record<string, unknown>;
  if (typeof columnId !== "number") return badRequest("columnId is required");
  if (typeof title !== "string" || title.trim() === "")
    return badRequest("title is required");
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  if (!isAssigneeId(assigneeId))
    return badRequest("assigneeId must be a user id or null");
  // Two-valued: absent means top-level, and there is no third state to encode —
  // 008 makes the field immutable, so "clear it" is not a request anyone can
  // make. Whether the id names a task on *this* board, and one that is not itself
  // a piece, is not decided here: both are tenancy and invariant questions,
  // answered in the repository against the same transaction that does the write.
  if (parentId !== undefined && !Number.isInteger(parentId))
    return badRequest("parentId must be a task id");
  // Not `!isTaskPriority(priority)`: undefined is legal here and means "use the
  // default", which is what the repository's ?? 'none' supplies. An unknown
  // string is not — it would reach Postgres and fail the enum cast as a 500.
  if (priority !== undefined && !isTaskPriority(priority))
    return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
  if (!isDueDate(dueDate))
    return badRequest("dueDate must be a YYYY-MM-DD date or null");
  if (!isLabelIds(labelIds))
    return badRequest("labelIds must be an array of label ids");

  try {
    const task = await createTask(principal, {
      columnId,
      title: title.trim(),
      description,
      assigneeId,
      priority,
      dueDate,
      labelIds,
      parentId: parentId as number | undefined,
    });
    return Response.json(task, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleListSubtasks(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    return Response.json(await listSubtasks(principal, id));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * Reading a single task by id — added for the MCP `get_task` tool, since a card's
 * pieces and an agent's "what does this task look like now" both want one task
 * rather than a whole board. The board has no per-task GET before this because the
 * human UI reads the board whole; an agent reasons task by task.
 */
export async function handleGetTask(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    const task = await getTask(principal, id);
    return task ? Response.json(task) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateTask(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const {
    title,
    description,
    columnId,
    position,
    assigneeId,
    priority,
    dueDate,
    labelIds,
  } = body as Record<string, unknown>;

  // Presence, not value. `{"assigneeId": null}` is a request to unassign and
  // must be told apart from a PATCH that never mentions the assignee — and
  // destructuring alone cannot: both hand back undefined.
  //
  // dueDate needs the same, since `{"dueDate": null}` clears a date. priority
  // does not: `{"priority": null}` is not a request to do anything, because
  // clearing a priority is `{"priority": "none"}`. It falls through to the
  // rejection below rather than being honoured as a clear.
  const setsAssignee = "assigneeId" in body;
  const setsDueDate = "dueDate" in body;

  // Refused rather than ignored, and the difference matters because the failure
  // is otherwise invisible. UpdateTaskInput has no parentId, so a PATCH carrying
  // one would be destructured into nothing, write nothing, and return 200 with
  // the unchanged task — telling the caller their re-parenting worked. 008's
  // trigger cannot save us here: it only fires on a write we never attempt.
  //
  // 400, not 409: a conflict is an action that would break an invariant, and this
  // one is not an action at all. There is no such request to make.
  if ("parentId" in body)
    return badRequest("parentId cannot be changed; it is set at creation");

  try {
    // A move request carries columnId + position; a content edit carries
    // title/description. Both may arrive in one PATCH.
    if (columnId !== undefined || position !== undefined) {
      if (typeof columnId !== "number" || typeof position !== "number")
        return badRequest("columnId and position are both required to move");
      const moved = await moveTask(principal, id, { columnId, position });
      if (!moved) return notFound();
    }

    if (
      title !== undefined ||
      description !== undefined ||
      setsAssignee ||
      priority !== undefined ||
      setsDueDate ||
      labelIds !== undefined
    ) {
      if (title !== undefined && (typeof title !== "string" || !title.trim()))
        return badRequest("title must be a non-empty string");
      if (description !== undefined && typeof description !== "string")
        return badRequest("description must be a string");
      if (!isAssigneeId(assigneeId))
        return badRequest("assigneeId must be a user id or null");
      if (priority !== undefined && !isTaskPriority(priority))
        return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
      if (!isDueDate(dueDate))
        return badRequest("dueDate must be a YYYY-MM-DD date or null");
      if (!isLabelIds(labelIds))
        return badRequest("labelIds must be an array of label ids");

      const updated = await updateTask(principal, id, {
        title: title as string | undefined,
        description: description as string | undefined,
        // Spread, so the key exists only when the caller sent it. Writing
        // `assigneeId: assigneeId` unconditionally would put an explicit
        // undefined on the object — and `"assigneeId" in input` would then be
        // true for every title-only edit, turning each one into an unassign.
        ...(setsAssignee ? { assigneeId: assigneeId ?? null } : {}),
        // No spread needed: priority is two-valued, so an explicit undefined on
        // the object means exactly what an absent key would — nothing was said.
        // The repository reads its value, not its presence.
        priority: priority as TaskPriority | undefined,
        // Spread, for assigneeId's reason exactly: `"dueDate" in input` decides
        // whether the date is written, so a stray undefined key would clear the
        // due date on every title-only edit.
        ...(setsDueDate ? { dueDate: dueDate as string | null } : {}),
        // No spread, like priority: labelIds is two-valued, so the repository
        // reads its value rather than its presence and an explicit undefined
        // means exactly what an absent key would.
        labelIds: labelIds as number[] | undefined,
      });
      if (!updated) return notFound();
      return Response.json(updated);
    }

    const task = await getTask(principal, id);
    return task ? Response.json(task) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTask(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    return (await deleteTask(principal, id))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
