import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import {
  authzErrorResponse,
  requireColumnRole,
} from "@/features/workspaces/server/authz";
import {
  PRIORITY_ORDER,
  RECURRENCE_FREQUENCIES,
  TASK_TYPES,
  isRecurrenceFrequency,
  isTaskPriority,
  isTaskType,
} from "../types";
import type {
  RecurrenceFrequency,
  TaskPriority,
  TaskSearchInput,
  TaskType,
} from "../types";
import {
  externalAgentTier,
  holdForExternalReview,
  planExternalAction,
  type HeldAction,
} from "@/features/agents/server/gate";
import {
  dryRunActive,
  dryRunPending,
  dryRunUnsupported,
} from "@/shared/db/dry-run";
import {
  blockedByPolicy,
  heldForReview,
} from "@/features/agents/server/door2";
import type { Principal } from "@/features/auth/server/principal";
import {
  claimTask,
  createTask,
  deleteTask,
  getTask,
  listSubtasks,
  moveTask,
  releaseTask,
  searchTasks,
  updateTask,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Task not found" }, { status: 404 });
}

type AgentPrincipal = Extract<Principal, { kind: "agent" }>;

/**
 * §7.4 parity for Door 2 is shared now — heldForReview and blockedByPolicy live
 * in agents/server/door2.ts, because the tasks slice stopped being the only one
 * that gates. Same 202/403 bodies; one definition.
 */

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

/**
 * A 0–10 score, or null ("unscored"), or absent ("leave it") — value/risk (034).
 * Bounded, unlike estimate: the CHECK in 034 refuses anything outside 0–10, and
 * this answers 400 rather than letting it reach the constraint as a 500.
 */
function isScore(value: unknown): value is number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10)
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
    objectiveId,
    value,
    risk,
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
  if (objectiveId !== undefined && objectiveId !== null && !Number.isInteger(objectiveId))
    return badRequest("objectiveId must be an objective id or null");
  if (!isScore(value))
    return badRequest("value must be an integer 0–10 or null");
  if (!isScore(risk)) return badRequest("risk must be an integer 0–10 or null");
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

  // Door-2 gate (§7.4): an external agent's create is changeset-tier by
  // default — proposed, not applied. The recorded input is exactly the
  // CreateTaskInput the review's applyProposed will hand to createTask.
  if (principal.kind === "agent") {
    const tool = parentId != null ? "create_subtask" : "create_task";
    const input = {
      columnId,
      title: title.trim(),
      ...(description !== undefined ? { description } : {}),
      ...(assignee !== undefined ? { assignee } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(estimate !== undefined ? { estimate } : {}),
      ...(milestoneId !== undefined ? { milestoneId } : {}),
      ...(sprintId !== undefined ? { sprintId } : {}),
      ...(epicId !== undefined ? { epicId } : {}),
      ...(objectiveId !== undefined ? { objectiveId } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(risk !== undefined ? { risk } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(labelIds !== undefined ? { labelIds } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(recurrence !== undefined ? { recurrence } : {}),
    };

    // A dry run reports every tier, so it comes before the block-tier refusal
    // below. The column check rides along as `authorize`: a create into a column
    // this agent cannot write to must not answer "would_apply".
    if (dryRunActive()) {
      try {
        await planExternalAction(principal, {
          tool,
          input,
          taskId: null,
          authorize: async () => {
            await requireColumnRole(principal, columnId, "member");
          },
        });
        return dryRunPending();
      } catch (error) {
        return authzErrorResponse(error);
      }
    }

    const tier = await externalAgentTier(principal, tool);
    if (tier === "block") return blockedByPolicy(tool);
    if (tier === "changeset") {
      try {
        // The same authz the apply will demand, checked before a changeset is
        // minted — a column the agent cannot write to answers 404/403 now, not
        // a junk proposal a reviewer could never accept.
        await requireColumnRole(principal, columnId, "member");
        const held = await holdForExternalReview(
          principal,
          [{ tool, input, taskId: (parentId as number | undefined) ?? null }],
          (parentId as number | undefined) ?? null
        );
        return heldForReview(held);
      } catch (error) {
        return authzErrorResponse(error);
      }
    }
  }

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
      objectiveId: objectiveId as number | null | undefined,
      value: value as number | null | undefined,
      risk: risk as number | null | undefined,
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
 * Board search over the query string (`GET /api/board/:id/tasks/search`).
 *
 * A GET with filters in the URL rather than a POST with a body, because a
 * search is a read: it is cacheable, loggable, and repeatable by pasting a
 * link, and none of those survive moving it into a body. The cost is parsing
 * scalars out of strings, which is what most of this function is.
 *
 * Unparseable filters are refused with 400 rather than dropped. A silently
 * ignored `priority=urgetn` returns the whole board and reads as "no tasks are
 * urgent" to a caller that cannot see it was ignored — the failure mode this
 * whole endpoint exists to prevent.
 */
export async function handleSearchTasks(request: Request, boardId: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const params = new URL(request.url).searchParams;
  const input: TaskSearchInput = {};

  const text = params.get("q") ?? params.get("text");
  if (text !== null) input.text = text;

  // Each integer filter shares one shape: absent leaves it alone, present must
  // parse, and a bad value is the caller's error rather than the server's guess.
  for (const [key, field] of [
    ["columnId", "columnId"],
    ["milestoneId", "milestoneId"],
    ["sprintId", "sprintId"],
    ["epicId", "epicId"],
    ["limit", "limit"],
    ["cursor", "cursor"],
  ] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (!Number.isInteger(value)) return badRequest(`Invalid ${key}`);
    (input as Record<string, unknown>)[field] = value;
  }

  const priority = params.get("priority");
  if (priority !== null) {
    if (!isTaskPriority(priority)) return badRequest("Invalid priority");
    input.priority = priority;
  }

  const type = params.get("type");
  if (type !== null) {
    if (!isTaskType(type)) return badRequest("Invalid type");
    input.type = type;
  }

  for (const key of ["dueBefore", "dueAfter"] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return badRequest(`${key} must be YYYY-MM-DD`);
    }
    input[key] = raw;
  }

  // The three-valued assignee, spelled in a query string: `assignee=none` is
  // the unassigned filter, `human:<id>` / `agent:<id>` name a principal, and an
  // absent parameter does not filter at all.
  const assignee = params.get("assignee");
  if (assignee !== null) {
    if (assignee === "none") {
      input.assignee = null;
    } else {
      const [kind, ...rest] = assignee.split(":");
      const id = rest.join(":");
      if ((kind !== "human" && kind !== "agent") || !id) {
        return badRequest("assignee must be none, human:<id>, or agent:<id>");
      }
      input.assignee = { type: kind, id };
    }
  }

  const labelIds = params.getAll("labelId");
  if (labelIds.length > 0) {
    const parsed = labelIds.map(Number);
    if (parsed.some((n) => !Number.isInteger(n))) return badRequest("Invalid labelId");
    input.labelIds = parsed;
  }

  if (params.get("includeSubtasks") === "true") input.includeSubtasks = true;
  if (params.get("openOnly") === "true") input.openOnly = true;

  try {
    return Response.json(await searchTasks(principal, boardId, input));
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
    objectiveId,
    value,
    risk,
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
  // value/risk three-valued (034), estimate's rule: `{"value": null}` unscores.
  const setsValue = "value" in body;
  const setsRisk = "risk" in body;
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
  // objectiveId three-valued too (037): `{"objectiveId": null}` un-aims the task.
  const setsObjective = "objectiveId" in body;
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

  const wantsMove = columnId !== undefined || position !== undefined;
  if (wantsMove && (typeof columnId !== "number" || typeof position !== "number"))
    return badRequest("columnId and position are both required to move");

  // Door-2 gate (§7.4): for an external agent, the consequential parts of a
  // PATCH — the move and the reassignment, §7.4's own examples — are held for
  // review while the auto-tier field edits riding in the same request apply
  // now, exactly as one native run's mixed tool calls would split.
  //
  // A dry run resolves no tier here at all: it reports one for every part of the
  // PATCH — including the block-tier parts this branch refuses outright — so the
  // early returns below would hide two thirds of the answer.
  const planning = principal.kind === "agent" && dryRunActive();
  let holdMove = false;
  let holdAssign = false;
  if (principal.kind === "agent") {
    if (setsAssignee && !isAssignee(assignee))
      return badRequest("assignee must be {type, id} or null");
    if (!planning) {
      if (wantsMove) {
        const tier = await externalAgentTier(principal, "move_task");
        if (tier === "block") return blockedByPolicy("move_task");
        holdMove = tier === "changeset";
      }
      if (setsAssignee) {
        const tier = await externalAgentTier(principal, "assign_task");
        if (tier === "block") return blockedByPolicy("assign_task");
        holdAssign = tier === "changeset";
      }
    }
  }
  // A planned assignment is reported as its own `assign_task` action, the same
  // split the held path makes, so it must not also ride in the update patch —
  // one request would otherwise report the same change twice.
  const appliesAssignee = setsAssignee && !holdAssign && !planning;

  try {
    // The plans are reported in the order the request would have applied them:
    // the move, then the field edits, then the assignment. The task is read once
    // up front so an id this agent cannot see answers 404 here rather than
    // reporting a plan against a null `before`.
    if (planning) {
      if (!(await getTask(principal, id))) return notFound();
      if (wantsMove)
        await planExternalAction(principal as AgentPrincipal, {
          tool: "move_task",
          input: { columnId, position },
          taskId: id,
        });
    }

    // A move request carries columnId + position; a content edit carries
    // title/description. Both may arrive in one PATCH.
    if (wantsMove && !holdMove && !planning) {
      const moved = await moveTask(principal, id, {
        columnId: columnId as number,
        position: position as number,
      });
      if (!moved) return notFound();
    }

    if (
      title !== undefined ||
      description !== undefined ||
      appliesAssignee ||
      priority !== undefined ||
      type !== undefined ||
      setsEstimate ||
      setsMilestone ||
      setsSprint ||
      setsEpic ||
      setsObjective ||
      setsValue ||
      setsRisk ||
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
      if (objectiveId !== undefined && objectiveId !== null && !Number.isInteger(objectiveId))
        return badRequest("objectiveId must be an objective id or null");
      if (!isScore(value))
        return badRequest("value must be an integer 0–10 or null");
      if (!isScore(risk))
        return badRequest("risk must be an integer 0–10 or null");
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

      const patch = {
        title: title as string | undefined,
        description: description as string | undefined,
        // Spread, so the key exists only when the caller sent it. Writing
        // `assignee: assignee` unconditionally would put an explicit undefined on
        // the object — and `"assignee" in input` would then be true for every
        // title-only edit, turning each one into an unassign. appliesAssignee,
        // not setsAssignee: an assignee held for review (Door-2 gate above) must
        // not also be written now.
        ...(appliesAssignee ? { assignee: assignee ?? null } : {}),
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
        // Spread, the same shape (037).
        ...(setsObjective ? { objectiveId: objectiveId as number | null } : {}),
        // Spread, estimate's shape (034): key present only when sent.
        ...(setsValue ? { value: value as number | null } : {}),
        ...(setsRisk ? { risk: risk as number | null } : {}),
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
      };

      if (planning) {
        // The projection is over the same patch updateTask would have received,
        // so what the dry run shows and what the real call would write are the
        // same object — not two descriptions of it that can drift apart.
        await planExternalAction(principal as AgentPrincipal, {
          tool: "update_task",
          input: patch,
          taskId: id,
        });
      } else {
        const updated = await updateTask(principal, id, patch);
        if (!updated) return notFound();
        if (!holdMove && !holdAssign) return Response.json(updated);
      }
    }

    if (planning && setsAssignee)
      await planExternalAction(principal as AgentPrincipal, {
        tool: "assign_task",
        input: { assignee: assignee ?? null },
        taskId: id,
      });

    if (holdMove || holdAssign) {
      // Read back first: it proves the task exists and is visible to this
      // agent before a changeset is minted for it, and it carries the state
      // the auto-tier remainder of the PATCH (if any) just wrote.
      const current = await getTask(principal, id);
      if (!current) return notFound();
      const actions: HeldAction[] = [];
      if (holdMove)
        actions.push({
          tool: "move_task",
          input: { id, columnId, position },
          taskId: id,
        });
      if (holdAssign)
        actions.push({
          tool: "assign_task",
          input: { id, assignee: assignee ?? null },
          taskId: id,
        });
      const held = await holdForExternalReview(
        principal as AgentPrincipal,
        actions,
        id
      );
      return heldForReview(held, { task: current });
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

  // A bulk edit is a loop over independent per-task mutations with partial
  // success, not one action with one before/after — there is no single plan to
  // report. The per-task endpoints each dry-run, which is where a caller that
  // wants to know should ask.
  if (dryRunActive())
    return dryRunUnsupported(
      "bulk_update_tasks",
      "a bulk edit is a loop of independent per-task mutations with partial success; dry-run the per-task endpoints instead"
    );

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

  // The lease length is optional and the body may be absent entirely — a claim
  // with no opinion about how long it needs is the common case, and requiring a
  // body for it would break every caller that predates the lease (076).
  const body = await request.json().catch(() => null);
  const ttlMinutes = (body as Record<string, unknown> | null)?.ttlMinutes;
  if (ttlMinutes !== undefined) {
    if (!Number.isInteger(ttlMinutes) || (ttlMinutes as number) < 1 || (ttlMinutes as number) > 1440) {
      return badRequest("ttlMinutes must be a whole number of minutes from 1 to 1440");
    }
  }

  // Not simulated, and said plainly rather than guessed at: whether this claim
  // succeeds depends on whether the current lease is live at the instant of the
  // write, which the repository decides under a row lock on the database clock.
  // Reading it without taking it would answer from a snapshot that is already
  // stale by the time the agent acts on it.
  if (dryRunActive())
    return dryRunUnsupported(
      "claim_task",
      "a claim's outcome depends on a lease read under a row lock at the moment of the write"
    );

  try {
    const task = await claimTask(principal, id, ttlMinutes as number | undefined);
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

  // claim_task's reason exactly, from the other side: who holds the lease now
  // decides whether this is a release or a 403, and that is a row-lock question.
  if (dryRunActive())
    return dryRunUnsupported(
      "release_task",
      "whether a release is yours to make depends on the lease as it stands at the moment of the write"
    );

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
