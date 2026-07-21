import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  PRIORITY_ORDER,
  RECURRENCE_FREQUENCIES,
  TASK_TYPES,
  isRecurrenceFrequency,
  isTaskPriority,
  isTaskType,
} from "../types";
import type { RecurrenceFrequency, TaskPriority, TaskType } from "../types";
import {
  claimTask,
  createTask,
  deleteTask,
  getTask,
  listSubtasks,
  moveTask,
  releaseTask,
  updateTask,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Task not found" }, { status: 404 });
}

/**
 * An assignee is an Actor now (011) — {type: 'human'|'agent', id} — or null
 * ("unassign") or absent ("leave alone"), and all three must pass, which is why
 * this is not a plain type check. The shape is validated here; whether the
 * principal is actually a member (a human) or an agent of *this* workspace is a
 * tenancy question, answered in the repository next to the RBAC checks against
 * the same transaction that does the write.
 *
 * The empty-string id is rejected: a "" id would reach the database as a lookup
 * that matches nothing and answers a confusing not_found, where the truth is that
 * the request was malformed.
 */
function isAssignee(
  value: unknown
): value is { type: "human" | "agent"; id: string } | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === "human" || v.type === "agent") &&
    typeof v.id === "string" &&
    v.id !== ""
  );
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

/**
 * A cadence, or null ("stop recurring"), or absent ("leave it") — the same
 * three-valued shape as isDueDate, and rejected the same way if it is a string
 * that names no frequency, so a typo answers 400 rather than reaching the enum
 * cast as a 500.
 */
function isRecurrence(
  value: unknown
): value is RecurrenceFrequency | null | undefined {
  return value === undefined || value === null || isRecurrenceFrequency(value);
}

/**
 * Points, or null ("unestimated"), or absent ("leave it") — dueDate's
 * three-valued shape (022). A non-negative integer only: the CHECK in 022 would
 * refuse a negative anyway, but as a 500 wearing a constraint name, where the
 * truth is that the request was malformed.
 */
function isEstimate(value: unknown): value is number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (Number.isInteger(value) && (value as number) >= 0)
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
    assignee,
    priority,
    type,
    estimate,
    milestoneId,
    sprintId,
    epicId,
    startDate,
    dueDate,
    labelIds,
    parentId,
    recurrence,
  } = body as Record<string, unknown>;
  if (typeof columnId !== "number") return badRequest("columnId is required");
  if (typeof title !== "string" || title.trim() === "")
    return badRequest("title is required");
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  if (!isAssignee(assignee))
    return badRequest("assignee must be {type, id} or null");
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
  // Not `!isTaskType(type)`: undefined is legal and means "use the default",
  // priority's shape exactly (022).
  if (type !== undefined && !isTaskType(type))
    return badRequest(`type must be one of: ${TASK_TYPES.join(", ")}`);
  if (!isEstimate(estimate))
    return badRequest("estimate must be a non-negative integer or null");
  if (milestoneId !== undefined && milestoneId !== null && !Number.isInteger(milestoneId))
    return badRequest("milestoneId must be a milestone id or null");
  if (sprintId !== undefined && sprintId !== null && !Number.isInteger(sprintId))
    return badRequest("sprintId must be a sprint id or null");
  if (epicId !== undefined && epicId !== null && !Number.isInteger(epicId))
    return badRequest("epicId must be an epic id or null");
  // isDueDate validates any YYYY-MM-DD-or-null date (032): the start date is one.
  if (!isDueDate(startDate))
    return badRequest("startDate must be a YYYY-MM-DD date or null");
  if (!isDueDate(dueDate))
    return badRequest("dueDate must be a YYYY-MM-DD date or null");
  if (!isLabelIds(labelIds))
    return badRequest("labelIds must be an array of label ids");
  if (!isRecurrence(recurrence))
    return badRequest(
      `recurrence must be one of: ${RECURRENCE_FREQUENCIES.join(", ")}, or null`
    );

  try {
    const task = await createTask(principal, {
      columnId,
      title: title.trim(),
      description,
      assignee,
      priority,
      type: type as TaskType | undefined,
      estimate: estimate as number | null | undefined,
      milestoneId: milestoneId as number | null | undefined,
      sprintId: sprintId as number | null | undefined,
      epicId: epicId as number | null | undefined,
      startDate: startDate as string | null | undefined,
      dueDate,
      labelIds,
      parentId: parentId as number | undefined,
      recurrence: recurrence as RecurrenceFrequency | null | undefined,
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
    assignee,
    priority,
    type,
    estimate,
    milestoneId,
    sprintId,
    epicId,
    startDate,
    dueDate,
    labelIds,
    recurrence,
  } = body as Record<string, unknown>;

  // Presence, not value. `{"assignee": null}` is a request to unassign and must
  // be told apart from a PATCH that never mentions the assignee — and
  // destructuring alone cannot: both hand back undefined.
  //
  // dueDate needs the same, since `{"dueDate": null}` clears a date. priority
  // does not: `{"priority": null}` is not a request to do anything, because
  // clearing a priority is `{"priority": "none"}`. It falls through to the
  // rejection below rather than being honoured as a clear.
  const setsAssignee = "assignee" in body;
  const setsDueDate = "dueDate" in body;
  // startDate three-valued (032), dueDate's twin: `{"startDate": null}` clears.
  const setsStartDate = "startDate" in body;
  // estimate is three-valued like dueDate (022): `{"estimate": null}` clears
  // it, so presence must be told apart from a PATCH that never mentions it.
  // type is two-valued like priority — `{"type": null}` is not a request.
  const setsEstimate = "estimate" in body;
  // milestoneId is three-valued too (026): `{"milestoneId": null}` un-aims.
  const setsMilestone = "milestoneId" in body;
  // sprintId three-valued too (028): `{"sprintId": null}` sends to backlog.
  const setsSprint = "sprintId" in body;
  // epicId three-valued too (031): `{"epicId": null}` un-files the task.
  const setsEpic = "epicId" in body;
  const setsRecurrence = "recurrence" in body;

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
      type !== undefined ||
      setsEstimate ||
      setsMilestone ||
      setsSprint ||
      setsEpic ||
      setsStartDate ||
      setsDueDate ||
      labelIds !== undefined ||
      setsRecurrence
    ) {
      if (title !== undefined && (typeof title !== "string" || !title.trim()))
        return badRequest("title must be a non-empty string");
      if (description !== undefined && typeof description !== "string")
        return badRequest("description must be a string");
      if (!isAssignee(assignee))
        return badRequest("assignee must be {type, id} or null");
      if (priority !== undefined && !isTaskPriority(priority))
        return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
      if (type !== undefined && !isTaskType(type))
        return badRequest(`type must be one of: ${TASK_TYPES.join(", ")}`);
      if (!isEstimate(estimate))
        return badRequest("estimate must be a non-negative integer or null");
      if (milestoneId !== undefined && milestoneId !== null && !Number.isInteger(milestoneId))
        return badRequest("milestoneId must be a milestone id or null");
      if (sprintId !== undefined && sprintId !== null && !Number.isInteger(sprintId))
        return badRequest("sprintId must be a sprint id or null");
      if (epicId !== undefined && epicId !== null && !Number.isInteger(epicId))
        return badRequest("epicId must be an epic id or null");
      if (!isDueDate(startDate))
        return badRequest("startDate must be a YYYY-MM-DD date or null");
      if (!isDueDate(dueDate))
        return badRequest("dueDate must be a YYYY-MM-DD date or null");
      if (!isLabelIds(labelIds))
        return badRequest("labelIds must be an array of label ids");
      if (!isRecurrence(recurrence))
        return badRequest(
          `recurrence must be one of: ${RECURRENCE_FREQUENCIES.join(", ")}, or null`
        );

      const updated = await updateTask(principal, id, {
        title: title as string | undefined,
        description: description as string | undefined,
        // Spread, so the key exists only when the caller sent it. Writing
        // `assignee: assignee` unconditionally would put an explicit undefined on
        // the object — and `"assignee" in input` would then be true for every
        // title-only edit, turning each one into an unassign.
        ...(setsAssignee ? { assignee: assignee ?? null } : {}),
        // No spread needed: priority is two-valued, so an explicit undefined on
        // the object means exactly what an absent key would — nothing was said.
        // The repository reads its value, not its presence.
        priority: priority as TaskPriority | undefined,
        // No spread, like priority: type is two-valued (022).
        type: type as TaskType | undefined,
        // Spread, like dueDate: estimate is three-valued (022), so the key must
        // exist only when the caller sent it — a stray undefined would clear
        // the estimate on every title-only edit.
        ...(setsEstimate ? { estimate: estimate as number | null } : {}),
        // Spread, the same shape (026).
        ...(setsMilestone ? { milestoneId: milestoneId as number | null } : {}),
        // Spread, the same shape (028).
        ...(setsSprint ? { sprintId: sprintId as number | null } : {}),
        // Spread, the same shape (031).
        ...(setsEpic ? { epicId: epicId as number | null } : {}),
        // Spread, dueDate's twin (032): the key must exist only when sent, or a
        // stray undefined would clear the start date on every title-only edit.
        ...(setsStartDate ? { startDate: startDate as string | null } : {}),
        // Spread, for assigneeId's reason exactly: `"dueDate" in input` decides
        // whether the date is written, so a stray undefined key would clear the
        // due date on every title-only edit.
        ...(setsDueDate ? { dueDate: dueDate as string | null } : {}),
        // No spread, like priority: labelIds is two-valued, so the repository
        // reads its value rather than its presence and an explicit undefined
        // means exactly what an absent key would.
        labelIds: labelIds as number[] | undefined,
        // Spread, like assignee/dueDate: recurrence is three-valued, so the key
        // must exist only when the caller sent it — a stray undefined would read
        // as "clear the rule" on every title-only edit.
        ...(setsRecurrence
          ? { recurrence: recurrence as RecurrenceFrequency | null }
          : {}),
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

/**
 * One request, many tasks — the list view's bulk bar. The body carries the ids
 * and what to do: `delete: true`, or any of columnId / assignee / priority /
 * dueDate to set on every task.
 *
 * A loop over the per-task repository functions rather than one multi-row
 * UPDATE, deliberately: each task keeps its own authz check, its own no-op
 * guard, and its own activity_log rows — "the M1 criterion is that every
 * mutation is attributable and revertible", and a single "updated 12 tasks"
 * write would be neither. At bulk scale (dozens, not thousands) the loop's
 * cost is invisible; the cap keeps it that way.
 *
 * Partial success is reported, not rolled back. The tasks are independent —
 * one the caller cannot touch should not undo eleven they can — so the answer
 * lists what failed and why, and the caller refetches either way.
 */
export async function handleBulkTasks(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { ids, columnId, assignee, priority, dueDate } = body as Record<
    string,
    unknown
  >;
  const wantsDelete = (body as Record<string, unknown>).delete === true;
  const setsAssignee = "assignee" in body;
  const setsDueDate = "dueDate" in body;

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => Number.isInteger(id))
  )
    return badRequest("ids must be a non-empty array of task ids");
  if (ids.length > 100) return badRequest("At most 100 tasks per request");
  if (columnId !== undefined && typeof columnId !== "number")
    return badRequest("columnId must be a column id");
  if (!isAssignee(assignee))
    return badRequest("assignee must be {type, id} or null");
  if (priority !== undefined && !isTaskPriority(priority))
    return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
  if (!isDueDate(dueDate))
    return badRequest("dueDate must be a YYYY-MM-DD date or null");
  if (
    !wantsDelete &&
    columnId === undefined &&
    !setsAssignee &&
    priority === undefined &&
    !setsDueDate
  )
    return badRequest("Nothing to do");
  if (wantsDelete && (columnId !== undefined || setsAssignee || priority !== undefined || setsDueDate))
    return badRequest("delete cannot be combined with edits");

  const failed: { id: number; error: string }[] = [];
  let updated = 0;
  for (const id of ids as number[]) {
    try {
      if (wantsDelete) {
        if (!(await deleteTask(principal, id))) throw new Error("Task not found");
      } else {
        if (columnId !== undefined) {
          // The end of the column: moveTask clamps to the sibling count, so a
          // huge index is "append", which is the only order a bulk move can
          // honestly promise.
          const moved = await moveTask(principal, id, {
            columnId,
            position: Number.MAX_SAFE_INTEGER,
          });
          if (!moved) throw new Error("Task not found");
        }
        if (setsAssignee || priority !== undefined || setsDueDate) {
          const edited = await updateTask(principal, id, {
            ...(setsAssignee ? { assignee: assignee ?? null } : {}),
            priority: priority as TaskPriority | undefined,
            ...(setsDueDate ? { dueDate: dueDate as string | null } : {}),
          });
          if (!edited) throw new Error("Task not found");
        }
      }
      updated += 1;
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : "Failed",
      });
    }
  }
  return Response.json({ updated, failed });
}

/**
 * Take the exclusive working claim on a task — PRD §4.3's hold, exposed to the
 * MCP door's claim_task tool. No body: the claimer is the request's principal,
 * the task is the id, and that is the whole input. A claim already held by
 * someone else surfaces as the repository's 409 through authzErrorResponse, which
 * is what an agent reads to know the task is taken.
 */
export async function handleClaimTask(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    const task = await claimTask(principal, id);
    return task ? Response.json(task) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * Drop a claim — the inverse of handleClaimTask, and DELETE on the same claim
 * sub-resource. The holder releases their own; an admin may release another's,
 * and a member reaching for someone else's hold gets the repository's 403. A
 * release of an unclaimed task is a no-op that still returns the task, so an
 * agent closing out work it never formally claimed does not fail here.
 */
export async function handleReleaseTask(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    const task = await releaseTask(principal, id);
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
