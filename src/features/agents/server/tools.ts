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
import { getBoard } from "@/features/board/server/repository";
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
        "Read a board: its columns and their top-level tasks (each with a subtaskCount). Omit boardId for the board this task is on. Column ids come from here.",
      inputSchema: z.object({ boardId: z.number().int().optional() }),
      run: async ({ boardId }) =>
        json(await getBoard(p, boardId ?? defaultBoardId)),
    }),
    betaZodTool({
      name: "get_task",
      description:
        "Read one task by id, including its column, priority, due date, labels, assignee, and subtaskCount.",
      inputSchema: z.object({ id: z.number().int() }),
      run: async ({ id }) => {
        const task = await getTask(p, id);
        return task ? json(task) : `No task ${id} in your workspace.`;
      },
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
        "Claim a task before working it — an exclusive hold that stops another agent grabbing the same one. A task already claimed by someone else is refused.",
      inputSchema: z.object({ id: z.number().int() }),
      run: ({ id }) =>
        gate(ctx, {
          tool: "claim_task",
          input: { id },
          taskId: id,
          execute: () => claimTask(p, id),
          describe: (t) =>
            t ? `Claimed task ${id}.` : `No task ${id} in your workspace.`,
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
        "Record that a task is blocked by another task on the same board — a blocked-by edge everyone can see (§7.1). Both ids must be tasks on the same board; a self-reference or a cycle is refused, and re-flagging an existing edge is a harmless no-op.",
      inputSchema: z.object({
        id: z.number().int(),
        dependsOnId: z.number().int(),
      }),
      run: ({ id, dependsOnId }) =>
        gate(ctx, {
          tool: "flag_blocker",
          // taskId: null — a dependency is a relationship between two tasks, not
          // state either one holds (018), so it never enters a TaskSnapshot; a
          // before/after task snapshot would be misleading. The input carries both
          // ids, which is the whole record of the edge.
          input: { id, dependsOnId },
          taskId: null,
          execute: () => addDependency(p, id, dependsOnId),
          describe: () => `Flagged task ${id} as blocked by ${dependsOnId}.`,
          proposal: `flag task ${id} as blocked by ${dependsOnId}`,
        }),
    }),

    // ---- changeset tier -------------------------------------------------
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
