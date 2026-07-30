import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  claimTask,
  createTask,
  getTask,
  listSubtasks,
  moveTask,
  releaseTask,
  updateTask,
} from "@/features/tasks/server/repository";
import { createComment } from "@/features/comments/server/repository";
import { addDependency } from "@/features/dependencies/server/repository";
import {
  DEFAULT_LINK,
  DEPENDENCY_TYPES,
  lagLabel,
  LAG_DAYS_MAX,
  LAG_DAYS_MIN,
} from "@/features/dependencies/types";
import { getBoard } from "@/features/board/server/repository";
import {
  createEpic,
  listEpics,
  updateEpic,
} from "@/features/epics/server/repository";
import { EPIC_STATUSES } from "@/features/epics/types";
import { getBoardRisks, getTaskRisk } from "@/features/board/server/analytics";
import { getScheduleProposal } from "@/features/board/server/schedule-proposal";
import {
  createObjective,
  listObjectives,
  updateKeyResult,
  updateObjective,
} from "@/features/objectives/server/repository";
import { principalActor } from "@/features/auth/server/principal";
import { listActivityForTask } from "@/features/activity/server/repository";
import { gate, type RunContext } from "./gate";

/**
 * Door 1's tool layer — the same board mutations Door 2 publishes over MCP
 * (mcp/server.mjs), but as in-process betaZodTool definitions the Tool Runner
 * drives directly. Each tool's `run` calls the SAME repository function the REST
 * API does, with the run's agent Principal, so the agent is subject to the exact
 * RBAC and audit trail a human is — §7.1's "not a privileged back door", reached
 * with no HTTP round-trip because the repository already takes a Principal.
 *
 * The tools are NARROW where Door 2's update_task is coarse — set_priority,
 * assign_task, move_task rather than one update_task — because §7.4's gate makes
 * a policy decision per tool, and a coarse tool would force one tier onto a
 * rename (auto) and a reassignment (changeset) alike. The sidebar in §7.4 is
 * explicit: "each mutation is a narrow, typed tool, so the harness ... can make
 * a policy decision about it."
 *
 * Mutations pass through the §7.4 gate (gate.ts); reads do not (they change
 * nothing). Deletion and archival are not exposed at all — the same cut Door 2
 * makes — so no tool here is ever block-tier by default.
 */

const priority = z.enum(["none", "low", "medium", "high", "urgent"]);
const taskType = z.enum(["task", "bug", "story"]);
const assignee = z
  .object({ type: z.enum(["human", "agent"]), id: z.string().min(1) })
  .nullable();

/** JSON, matching Door 2's `ok()` — the model reads structured board state. */
const json = (data: unknown) => JSON.stringify(data, null, 2);

/**
 * The tool set for one run. `defaultBoardId` is the board the assigned task sits
 * on, so read tools can default to a real board the way Door 2's /api/agent/me
 * lets its tools (the agent is handed one board, not asked to discover ids).
 * `allowlist` (012) narrows the returned set; null means every tool.
 */
export function buildTools(
  ctx: RunContext,
  defaultBoardId: number,
  allowlist: string[] | null
) {
  const p = ctx.principal;

  const tools = [
    // ---- reads (ungated) ------------------------------------------------
    betaZodTool({
      name: "list_board",
      description:
        "Read a board: its columns and their top-level tasks (each with a subtaskCount), plus the delivery risk currently scored on the board. Omit boardId for the board this task is on. Column ids come from here.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      // Risk rides along rather than waiting to be asked for (4.2). An agent
      // reading a board to decide what to do next needs to know what is late,
      // blocked, or aging, and a signal it has to know to ask for is a signal
      // most runs will never see. One extra query, and only scored tasks appear.
      run: async ({ boardId }) => {
        const id = boardId ?? defaultBoardId;
        const [board, risks] = await Promise.all([
          getBoard(p, id),
          getBoardRisks(p, id),
        ]);
        return json({ ...board, risks });
      },
    }),
    betaZodTool({
      name: "get_task",
      description:
        "Read one task by id, including its column, priority, due date, labels, assignee, subtaskCount, and its delivery risk (null when nothing is firing).",
      inputSchema: z.object({ id: z.number().int() }),
      run: async ({ id }) => {
        const task = await getTask(p, id);
        if (!task) return `No task ${id} in your workspace.`;
        return json({ ...task, risk: await getTaskRisk(p, id) });
      },
    }),
    betaZodTool({
      name: "list_objectives",
      description:
        "A board's objectives and their key results (037), each with its progress rolled up from the key results' current values. Key-result ids for score_key_result come from here.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      run: async ({ boardId }) =>
        json(await listObjectives(p, boardId ?? defaultBoardId)),
    }),
    betaZodTool({
      name: "list_epics",
      description:
        "A board's epics (031) — the coarse groupings tasks and milestones are filed under, each with its status, owner, progress, and the window its contents describe. Epic ids for assign_to_epic come from here.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      run: async ({ boardId }) =>
        json(await listEpics(p, boardId ?? defaultBoardId)),
    }),
    betaZodTool({
      name: "propose_schedule",
      description:
        "Propose start and due dates for a board's tasks (4.1): a dependency-ordered pass that respects each assignee's weekly capacity, returning a start/due date per task with the reasons behind it. A PROPOSAL — nothing is written. Report it, or set the dates you agree with one at a time via set_due_date, which is a change a human can see and undo.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      // Read-only on purpose. applyScheduleProposal exists and would fit here in
      // one line, but it rewrites the dates of every task on the board in a
      // single call — a blast radius with no natural unit for a human to review.
      // The agent computes the plan; a person applies it.
      run: async ({ boardId }) =>
        json(await getScheduleProposal(p, boardId ?? defaultBoardId)),
    }),
    betaZodTool({
      name: "score_risk",
      description:
        "Score delivery risk across a board (4.2): every task showing a signal, highest first, each with a 0–1 score, a low/medium/high level, and the reasons that produced it (overdue, blocked by N tasks, open for N days). Deterministic and explainable — the facts are the board's, not a judgement. Omit boardId for the board this task is on.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      run: async ({ boardId }) =>
        json(await getBoardRisks(p, boardId ?? defaultBoardId)),
    }),
    betaZodTool({
      name: "list_subtasks",
      description: "Read a task's subtasks (its decomposed pieces).",
      inputSchema: z.object({ id: z.number().int() }),
      run: async ({ id }) => json(await listSubtasks(p, id)),
    }),
    betaZodTool({
      name: "task_history",
      description:
        "Read a task's activity log — every change to it, newest first, with who did it. Read this before acting on a task others may have touched.",
      inputSchema: z.object({ id: z.number().int() }),
      run: async ({ id }) => json(await listActivityForTask(p, id)),
    }),

    // ---- auto tier ------------------------------------------------------
    betaZodTool({
      name: "comment_on_task",
      description:
        "Post a comment on a task under your own name — your channel for reporting what you did or why.",
      inputSchema: z.object({ id: z.number().int(), body: z.string().min(1) }),
      run: ({ id, body }) =>
        gate(ctx, {
          tool: "comment_on_task",
          input: { id, body },
          taskId: null,
          execute: () => createComment(p, { taskId: id, body }),
          describe: () => `Commented on task ${id}.`,
          proposal: `comment on task ${id}`,
        }),
    }),
    betaZodTool({
      name: "claim_task",
      description:
        "Claim a task before working it — an exclusive hold that stops another agent grabbing the same one. A task already claimed by someone else is refused. Claiming your own hold again renews the lease. The lease expires, so a crashed agent cannot wedge a task forever; ttlMinutes sets how long you expect to need it (default 60).",
      // The lease length is Door 2's already (mcp/server.mjs claim_task), and a
      // tool one door publishes and the other does not is the parity PRD §7.1
      // forbids: an agent that can hold a task for a working day on the MCP door
      // and only an hour here is the same agent under two policies. Bounds match
      // the HTTP handler's (1 minute to a day) so all three doors refuse the same
      // inputs rather than each inventing a ceiling.
      inputSchema: z.object({
        id: z.number().int(),
        ttlMinutes: z.number().int().min(1).max(1440).optional(),
      }),
      run: ({ id, ttlMinutes }) =>
        gate(ctx, {
          tool: "claim_task",
          input: { id, ttlMinutes },
          taskId: id,
          execute: () => claimTask(p, id, ttlMinutes),
          describe: (t) =>
            t
              ? `Claimed task ${id}${t.claimExpiresAt ? ` until ${t.claimExpiresAt}` : ""}.`
              : `No task ${id} in your workspace.`,
          proposal: `claim task ${id}`,
        }),
    }),
    betaZodTool({
      name: "release_task",
      description: "Release your claim on a task when you stop or finish it.",
      inputSchema: z.object({ id: z.number().int() }),
      run: ({ id }) =>
        gate(ctx, {
          tool: "release_task",
          input: { id },
          taskId: id,
          execute: () => releaseTask(p, id),
          describe: () => `Released task ${id}.`,
          proposal: `release task ${id}`,
        }),
    }),
    betaZodTool({
      name: "set_priority",
      description:
        "Set a task's priority (none | low | medium | high | urgent) — the core triage action.",
      inputSchema: z.object({ id: z.number().int(), priority }),
      run: ({ id, priority: value }) =>
        gate(ctx, {
          tool: "set_priority",
          input: { id, priority: value },
          taskId: id,
          execute: () => updateTask(p, id, { priority: value }),
          describe: () => `Set task ${id} priority to ${value}.`,
          proposal: `set task ${id} priority to ${value}`,
        }),
    }),
    betaZodTool({
      name: "set_labels",
      description:
        "Set the full label set on a task (the controlled workspace vocabulary — get ids from a labelled task or list_board). Pass [] to clear.",
      inputSchema: z.object({
        id: z.number().int(),
        labelIds: z.array(z.number().int()),
      }),
      run: ({ id, labelIds }) =>
        gate(ctx, {
          tool: "set_labels",
          input: { id, labelIds },
          taskId: id,
          execute: () => updateTask(p, id, { labelIds }),
          describe: () => `Set task ${id} labels.`,
          proposal: `set task ${id} labels to [${labelIds.join(", ")}]`,
        }),
    }),
    betaZodTool({
      name: "set_due_date",
      description:
        "Set or clear a task's due date (YYYY-MM-DD, or null to clear).",
      inputSchema: z.object({
        id: z.number().int(),
        dueDate: z.string().nullable(),
      }),
      run: ({ id, dueDate }) =>
        gate(ctx, {
          tool: "set_due_date",
          input: { id, dueDate },
          taskId: id,
          execute: () => updateTask(p, id, { dueDate }),
          describe: () =>
            dueDate ? `Set task ${id} due ${dueDate}.` : `Cleared task ${id} due date.`,
          proposal: dueDate
            ? `set task ${id} due date to ${dueDate}`
            : `clear task ${id} due date`,
        }),
    }),
    betaZodTool({
      name: "set_estimate",
      description:
        "Set a task's effort estimate in points (022), or null to clear it. 0 is a valid estimate (\"free\"); null means unestimated.",
      inputSchema: z.object({
        id: z.number().int(),
        estimate: z.number().int().min(0).nullable(),
      }),
      run: ({ id, estimate }) =>
        gate(ctx, {
          tool: "set_estimate",
          input: { id, estimate },
          taskId: id,
          execute: () => updateTask(p, id, { estimate }),
          describe: () =>
            estimate === null
              ? `Cleared task ${id} estimate.`
              : `Set task ${id} estimate to ${estimate} points.`,
          proposal:
            estimate === null
              ? `clear task ${id} estimate`
              : `set task ${id} estimate to ${estimate} points`,
        }),
    }),
    betaZodTool({
      name: "set_type",
      description:
        "Set what kind of work a task is (task | bug | story) — the triage classification (022).",
      inputSchema: z.object({ id: z.number().int(), type: taskType }),
      run: ({ id, type }) =>
        gate(ctx, {
          tool: "set_type",
          input: { id, type },
          taskId: id,
          execute: () => updateTask(p, id, { type }),
          describe: () => `Set task ${id} type to ${type}.`,
          proposal: `set task ${id} type to ${type}`,
        }),
    }),
    betaZodTool({
      name: "score_task",
      description:
        "Score a task for prioritisation (034): value and risk on a 0–10 scale, or null to clear either. With the task's estimate this yields a priority score = value / (estimate × (1 + risk/10)) the board ranks by — the triage payoff. Pass whichever of value/risk you mean to set.",
      inputSchema: z.object({
        id: z.number().int(),
        value: z.number().int().min(0).max(10).nullish(),
        risk: z.number().int().min(0).max(10).nullish(),
      }),
      run: ({ id, value, risk }) =>
        gate(ctx, {
          tool: "score_task",
          input: { id, value, risk },
          taskId: id,
          // Spread so a field is written only when the caller named it — an
          // absent key leaves that input alone, updateTask's presence rule (034).
          execute: () =>
            updateTask(p, id, {
              ...(value !== undefined ? { value } : {}),
              ...(risk !== undefined ? { risk } : {}),
            }),
          describe: () => `Scored task ${id} (value ${value ?? "—"}, risk ${risk ?? "—"}).`,
          proposal: `score task ${id} value ${value ?? "—"} risk ${risk ?? "—"}`,
        }),
    }),
    betaZodTool({
      name: "aim_at_milestone",
      description:
        "Aim a task at one of its board's milestones (026), or null to un-aim it. Get the milestone id from list_board or a task already aimed at it; a milestone on another board is refused.",
      inputSchema: z.object({
        id: z.number().int(),
        milestoneId: z.number().int().nullable(),
      }),
      run: ({ id, milestoneId }) =>
        gate(ctx, {
          tool: "aim_at_milestone",
          input: { id, milestoneId },
          taskId: id,
          execute: () => updateTask(p, id, { milestoneId }),
          describe: () =>
            milestoneId === null
              ? `Un-aimed task ${id} from its milestone.`
              : `Aimed task ${id} at milestone ${milestoneId}.`,
          proposal:
            milestoneId === null
              ? `un-aim task ${id} from its milestone`
              : `aim task ${id} at milestone ${milestoneId}`,
        }),
    }),
    betaZodTool({
      name: "assign_to_epic",
      description:
        "File a task under one of its board's epics (031), or null to un-file it. Get the epic id from list_epics; an epic on another board is refused. Filing is grouping, not a change of plan — the task's column, dates and assignee are untouched.",
      inputSchema: z.object({
        id: z.number().int(),
        epicId: z.number().int().nullable(),
      }),
      // Door 2 has published this since 031 and Door 1 never did, so the native
      // runtime could not see epics at all — the parity gap the code review's
      // "20 vs 11" counts. auto is aim_at_milestone's tier and for its reason:
      // filing is silent outside the board, idempotent, and undone by filing it
      // back.
      run: ({ id, epicId }) =>
        gate(ctx, {
          tool: "assign_to_epic",
          input: { id, epicId },
          taskId: id,
          execute: () => updateTask(p, id, { epicId }),
          describe: () =>
            epicId === null
              ? `Un-filed task ${id} from its epic.`
              : `Filed task ${id} under epic ${epicId}.`,
          proposal:
            epicId === null
              ? `un-file task ${id} from its epic`
              : `file task ${id} under epic ${epicId}`,
        }),
    }),
    betaZodTool({
      name: "rename_task",
      description: "Edit a task's title and/or description.",
      inputSchema: z.object({
        id: z.number().int(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
      run: ({ id, title, description }) =>
        gate(ctx, {
          tool: "rename_task",
          input: { id, title, description },
          taskId: id,
          execute: () => updateTask(p, id, { title, description }),
          describe: () => `Edited task ${id}.`,
          proposal: `edit task ${id}`,
        }),
    }),
    betaZodTool({
      name: "flag_blocker",
      description:
        "Record that a task is blocked by another task on the same board — a blocked-by edge everyone can see (§7.1). Both ids must be tasks on the same board; a self-reference or a cycle is refused, and re-flagging an existing edge is a harmless no-op. Optionally say what the link means: FS (default) the blocker must finish before this starts, SS they start together, FF they finish together — with lagDays as a signed offset in days (negative overlaps them). Re-flagging an edge with a different type or lag changes it.",
      inputSchema: z.object({
        id: z.number().int(),
        dependsOnId: z.number().int(),
        type: z.enum(DEPENDENCY_TYPES).optional(),
        lagDays: z.number().int().min(LAG_DAYS_MIN).max(LAG_DAYS_MAX).optional(),
      }),
      run: ({ id, dependsOnId, type, lagDays }) => {
        // Absent means DEFAULT_LINK, so an agent written against the pre-087
        // schema emits byte-identical calls and gets byte-identical edges. The
        // tool's gate tier is unchanged for the same reason: naming what a link
        // means is the same blast radius as declaring it, and both stay auto.
        const link = {
          type: type ?? DEFAULT_LINK.type,
          lagDays: lagDays ?? DEFAULT_LINK.lagDays,
        };
        const how =
          link.type === DEFAULT_LINK.type && link.lagDays === DEFAULT_LINK.lagDays
            ? ""
            : ` (${link.type}${lagLabel(link.lagDays)})`;
        return gate(ctx, {
          tool: "flag_blocker",
          // taskId: null — a dependency is a relationship between two tasks, not
          // state either one holds (018), so it never enters a TaskSnapshot; a
          // before/after task snapshot would be misleading. The input carries both
          // ids and the link, which is the whole record of the edge.
          input: { id, dependsOnId, ...link },
          taskId: null,
          execute: () => addDependency(p, id, dependsOnId, link),
          describe: () =>
            `Flagged task ${id} as blocked by ${dependsOnId}${how}.`,
          proposal: `flag task ${id} as blocked by ${dependsOnId}${how}`,
        });
      },
    }),

    betaZodTool({
      name: "score_key_result",
      description:
        "Record a key result's current value (037) — the measurement, not the target. Ids come from list_objectives. This is how you report progress on an objective; you cannot change what the key result measures or what it is aiming at.",
      inputSchema: z.object({
        id: z.number().int(),
        currentValue: z.number(),
      }),
      run: ({ id, currentValue }) =>
        gate(ctx, {
          tool: "score_key_result",
          input: { id, currentValue },
          // Not a task, so no snapshot: a key result is not board state a
          // TaskSnapshot could hold, and the input is the whole record.
          taskId: null,
          execute: () => updateKeyResult(p, id, { currentValue }),
          describe: () => `Set key result ${id} to ${currentValue}.`,
          proposal: `set key result ${id} current value to ${currentValue}`,
        }),
    }),

    // ---- changeset tier -------------------------------------------------
    betaZodTool({
      name: "set_objective",
      description:
        "Create an objective on a board, or edit one by id (037): its name, description, and due date. A consequential change — an objective says what the team is for — so it is held for human review by default. Use score_key_result to report progress against one that already exists.",
      inputSchema: z.object({
        id: z.number().int().optional(),
        boardId: z.number().int().optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        dueDate: z.string().nullish(),
      }),
      run: ({ id, boardId, name, description, dueDate }) => {
        const board = boardId ?? defaultBoardId;
        return gate(ctx, {
          tool: "set_objective",
          // boardId is recorded even on an edit so the proposal reads on its
          // own; the create path genuinely needs it to be appliable later.
          input: { ...(id !== undefined ? { id } : { boardId: board }), name, description, dueDate },
          taskId: null,
          execute: async () => {
            if (id === undefined) {
              if (!name) throw new Error("A new objective needs a name.");
              return createObjective(
                p,
                board,
                { name, description, dueDate: dueDate ?? undefined },
                principalActor(p)
              );
            }
            return updateObjective(
              p,
              id,
              {
                name,
                description,
                ...(dueDate !== undefined ? { dueDate: dueDate ?? null } : {}),
              },
              principalActor(p)
            );
          },
          describe: () =>
            id === undefined ? `Created objective "${name}".` : `Edited objective ${id}.`,
          proposal:
            id === undefined
              ? `create objective "${name}" on board ${board}`
              : `edit objective ${id}`,
        });
      },
    }),
    betaZodTool({
      name: "set_epic",
      description:
        "Create an epic on a board, or edit one by id (031/089): its name, its status (proposed/active/paused/done), and the person who owns it. An epic names a body of work the team is doing, so — like set_objective — it is held for human review by default. Use assign_to_epic to file a task under one that already exists. An epic has no dates of its own: its window is read from the work inside it.",
      inputSchema: z.object({
        id: z.number().int().optional(),
        boardId: z.number().int().optional(),
        name: z.string().min(1).optional(),
        status: z.enum(EPIC_STATUSES as unknown as [string, ...string[]]).optional(),
        ownerId: z.string().nullish(),
      }),
      run: ({ id, boardId, name, status, ownerId }) => {
        const board = boardId ?? defaultBoardId;
        return gate(ctx, {
          tool: "set_epic",
          // set_objective's recording rule: boardId rides even on an edit so the
          // proposal reads on its own, and the create path needs it to be
          // appliable later.
          input: {
            ...(id !== undefined ? { id } : { boardId: board }),
            name,
            status,
            ownerId,
          },
          taskId: null,
          execute: async () => {
            const epicStatus = status as
              | (typeof EPIC_STATUSES)[number]
              | undefined;
            if (id === undefined) {
              if (!name) throw new Error("A new epic needs a name.");
              return createEpic(
                p,
                board,
                { name, status: epicStatus, ownerId: ownerId ?? null },
                principalActor(p)
              );
            }
            return updateEpic(
              p,
              id,
              {
                name,
                status: epicStatus,
                // Three-valued, and the spread is what keeps it so: an absent
                // ownerId leaves the owner, an explicit null un-owns the epic.
                ...(ownerId !== undefined ? { ownerId: ownerId ?? null } : {}),
              },
              principalActor(p)
            );
          },
          describe: () =>
            id === undefined ? `Created epic "${name}".` : `Edited epic ${id}.`,
          proposal:
            id === undefined
              ? `create epic "${name}" on board ${board}`
              : `edit epic ${id}`,
        });
      },
    }),
    betaZodTool({
      name: "assign_task",
      description:
        "Assign a task to a person or agent, or null to unassign. {type:'human'|'agent', id}. A consequential change — held for human review.",
      inputSchema: z.object({ id: z.number().int(), assignee }),
      run: ({ id, assignee: who }) =>
        gate(ctx, {
          tool: "assign_task",
          input: { id, assignee: who },
          taskId: id,
          execute: () => updateTask(p, id, { assignee: who }),
          describe: () => `Assigned task ${id}.`,
          proposal: who
            ? `assign task ${id} to ${who.type} ${who.id}`
            : `unassign task ${id}`,
        }),
    }),
    betaZodTool({
      name: "move_task",
      description:
        "Move a task to a column and position — this is how a task's status changes. position is 0-based within the destination column. Held for human review.",
      inputSchema: z.object({
        id: z.number().int(),
        columnId: z.number().int(),
        position: z.number().int().min(0),
      }),
      run: ({ id, columnId, position }) =>
        gate(ctx, {
          tool: "move_task",
          input: { id, columnId, position },
          taskId: id,
          execute: () => moveTask(p, id, { columnId, position }),
          describe: () => `Moved task ${id} to column ${columnId}.`,
          proposal: `move task ${id} to column ${columnId} (position ${position})`,
        }),
    }),
    betaZodTool({
      name: "create_task",
      description:
        "Create a task in a column (get columnId from list_board). Held for human review.",
      inputSchema: z.object({
        columnId: z.number().int(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: priority.optional(),
        value: z.number().int().min(0).max(10).optional(),
        risk: z.number().int().min(0).max(10).optional(),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        labelIds: z.array(z.number().int()).optional(),
      }),
      run: (input) =>
        gate(ctx, {
          tool: "create_task",
          input,
          taskId: null,
          execute: () => createTask(p, input),
          describe: (t) => `Created task ${t.id}: "${t.title}".`,
          proposal: `create task "${input.title}" in column ${input.columnId}`,
        }),
    }),
    betaZodTool({
      name: "create_subtask",
      description:
        "Decompose a task into a piece — a whole task with its own status — under a parent. Held for human review.",
      inputSchema: z.object({
        parentId: z.number().int(),
        columnId: z.number().int(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: priority.optional(),
        dueDate: z.string().optional(),
      }),
      run: ({ parentId, ...rest }) =>
        gate(ctx, {
          tool: "create_subtask",
          input: { parentId, ...rest },
          taskId: null,
          execute: () => createTask(p, { parentId, ...rest }),
          describe: (t) => `Created subtask ${t.id} under task ${parentId}.`,
          proposal: `create a subtask "${rest.title}" under task ${parentId}`,
        }),
    }),
  ];

  if (!allowlist) return tools;
  const allowed = new Set(allowlist);
  // Reads are never gated and never withheld — an agent that cannot see the
  // board cannot act on it, and the allowlist governs what it may *change*.
  const READS = new Set(["list_board", "get_task", "list_subtasks", "task_history"]);
  return tools.filter((t) => READS.has(t.name) || allowed.has(t.name));
}
