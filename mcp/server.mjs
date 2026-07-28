#!/usr/bin/env node
// The kanban MCP server — PRD §7.1 "Door 2".
//
// A stdio server any MCP-speaking coding agent (Claude Code, Codex, Cursor) can
// register. It is a THIN adapter: every tool is one authenticated call to the
// REST API the human UI already uses, so an agent is subject to the exact RBAC
// and audit trail a person is — "not a privileged back door" (§7.1). All the
// logic lives server-side; this file only maps tools to endpoints.
//
// It authenticates as a workspace-scoped agent (009) by presenting its token in
// the `x-agent-key` header. Mint one with scripts/create-agent.mjs.
//
//   KANBAN_URL=http://localhost:3000 KANBAN_AGENT_KEY=kbn_… npm run mcp
//
// Optional: KANBAN_BOARD_ID pins the board every boardId-taking tool defaults
// to. Without it the default is the workspace's first board, which is a guess —
// in a multi-board workspace, pin it.
//
// stdout is the MCP transport — never write to it. Diagnostics go to stderr.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.KANBAN_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.KANBAN_AGENT_KEY;
if (!KEY) {
  console.error(
    "KANBAN_AGENT_KEY is not set. Create an agent with:\n" +
      '  node --env-file=.env.local scripts/create-agent.mjs --workspace <slug> --name "Agent"'
  );
  process.exit(1);
}

// The version travels from package.json rather than being retyped here, because
// a hardcoded "0.1.0" is a number that goes stale the first time anyone ships
// and is then worse than no version at all — a client logging it would report a
// release that never existed.
const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0-unknown";
  }
})();

const TIMEOUT_MS = Number(process.env.KANBAN_TIMEOUT_MS ?? 15000);

/**
 * A failure the model can act on rather than a sentence it must guess at.
 *
 * The old adapter collapsed every failure to `new Error(message)`, which made a
 * 409 "someone else holds this claim" and a 500 "the database is down" the same
 * event to a model: both arrive as prose, and the only strategies prose affords
 * are "retry forever" and "give up". `code` says what happened, `retryable`
 * says whether trying again could ever change the answer, and `status` keeps
 * the raw HTTP fact for a human reading the log.
 */
class ApiError extends Error {
  constructor(code, status, message, retryable) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
  toPayload() {
    return {
      error: { code: this.code, status: this.status, message: this.message, retryable: this.retryable },
    };
  }
}

/**
 * HTTP status → a code the model can branch on.
 *
 * The server already sends its own `code` on the two responses where the
 * distinction is subtle (HELD_FOR_REVIEW, BLOCKED_BY_POLICY); that one wins
 * when present, and this table is the fallback for everything else. `retryable`
 * is deliberately narrow: only a rate limit, a timeout, and a 5xx can come out
 * differently on a second attempt. A 409 claim conflict will not, and an agent
 * that retries one is an agent spinning on another agent's work.
 */
function classify(status, body) {
  const serverCode = typeof body?.code === "string" ? body.code : null;
  const table = {
    400: ["INVALID_REQUEST", false],
    401: ["AUTH_INVALID", false],
    403: ["FORBIDDEN", false],
    404: ["NOT_FOUND", false],
    409: ["CONFLICT", false],
    413: ["TOO_LARGE", false],
    429: ["RATE_LIMITED", true],
  };
  if (table[status]) return [serverCode ?? table[status][0], table[status][1]];
  if (status >= 500) return [serverCode ?? "SERVER_ERROR", true];
  return [serverCode ?? "HTTP_ERROR", false];
}

/**
 * One authenticated REST call, with the three things a network call needs and
 * the old one had none of: a deadline, a bounded retry, and a body parse that
 * cannot itself throw an unrelated error.
 *
 * The parse is the subtle one. `JSON.parse` on any non-empty body meant a proxy
 * returning an HTML 502 page surfaced to the model as
 * `SyntaxError: Unexpected token '<'` — a message about JSON syntax for an
 * event that was nothing to do with JSON. Now a non-JSON body keeps its status
 * and shows its first 200 characters, which is the difference between "the
 * gateway is down" and a puzzle.
 *
 * Retries are for idempotent reads only. A POST that timed out may well have
 * been applied — the socket died, not the transaction — so retrying it risks a
 * second task, a second comment, a second claim. Reads have no such hazard.
 */
async function api(method, path, body, { retries = method === "GET" ? 2 : 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      // Backoff with jitter, so N agents that hit the same 429 do not all come
      // back at the same instant and reproduce it.
      const wait = 250 * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          "x-agent-key": KEY,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      // A transport failure never reached the server, so even a mutation is
      // safe to surface as retryable — but only reads are retried here.
      lastError = new ApiError(
        cause?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
        0,
        `${method} ${path}: ${cause?.message ?? "request failed"}`,
        true
      );
      continue;
    }

    const text = await res.text();
    let data = null;
    let parseFailed = false;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parseFailed = true;
      }
    }

    if (res.ok) {
      if (parseFailed) {
        throw new ApiError(
          "BAD_RESPONSE",
          res.status,
          `${method} ${path} returned a non-JSON body: ${text.slice(0, 200)}`,
          false
        );
      }
      return data;
    }

    const [code, retryable] = classify(res.status, data);
    const message = parseFailed
      ? `${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`
      : (data?.message ?? data?.error ?? `${method} ${path} failed (${res.status})`);
    lastError = new ApiError(code, res.status, message, retryable);
    if (!retryable) throw lastError;
  }
  throw lastError;
}

/**
 * /api/agent/me — the agent's own identity and the boards its token reaches.
 *
 * Cached, but the cache is cleared on rejection. The previous version assigned
 * the promise with `??=` and never cleared it, so one failure at startup (the
 * app not up yet, which is the common case) poisoned every tool for the life of
 * the process: each call awaited the same rejected promise and the operator saw
 * a server that never recovered from a race it lost once.
 */
let mePromise;
function me() {
  if (!mePromise) {
    mePromise = api("GET", "/api/agent/me").catch((error) => {
      mePromise = undefined;
      throw error;
    });
  }
  return mePromise;
}

const PINNED_BOARD = process.env.KANBAN_BOARD_ID
  ? Number(process.env.KANBAN_BOARD_ID)
  : null;

async function defaultBoardId() {
  if (PINNED_BOARD !== null) return PINNED_BOARD;
  const info = await me();
  if (!info.boards?.length) {
    throw new ApiError("NOT_FOUND", 404, "This agent's workspace has no boards.", false);
  }
  if (info.boards.length > 1) {
    // Not an error — a default has to be something — but the operator should
    // know a guess was made, and KANBAN_BOARD_ID is how they stop it.
    console.error(
      `kanban: ${info.boards.length} boards in this workspace; defaulting to ` +
        `#${info.boards[0].id} "${info.boards[0].name}". Set KANBAN_BOARD_ID to pin one.`
    );
  }
  return info.boards[0].id;
}

const board = async (boardId) => boardId ?? (await defaultBoardId());
const workspaceId = async () => (await me()).workspaceId;

const server = new McpServer({ name: "kanban", version: VERSION });

const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data && typeof data === "object" && !Array.isArray(data) ? data : { result: data },
});

/**
 * Register a tool whose body is one REST call.
 *
 * Errors come back as the structured payload rather than a bare string, so a
 * model reading the result can tell a conflict from an outage without parsing
 * English. `isError` still marks it as a failure for clients that only look at
 * the flag.
 */
function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return ok(await run(args ?? {}));
    } catch (error) {
      const payload =
        error instanceof ApiError
          ? error.toPayload()
          : { error: { code: "TOOL_ERROR", status: 0, message: error.message, retryable: false } };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true,
      };
    }
  });
}

const priority = z.enum(["none", "low", "medium", "high", "urgent"]);
const taskType = z.enum(["task", "bug", "story"]);

// A calendar date, validated here rather than discovered as a 400 three hops
// away. The regex is the shape; the server still owns whether 2026-02-30 is a
// day (it is not) — this only stops "next Tuesday" reaching it.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD calendar date");

// An assignee is a principal (011): a person or an agent. {type,id} rather than a
// bare id so one field carries both — pass null to unassign. Get a human's id
// from list_assignees, an agent's from its identity.
const assignee = z
  .object({ type: z.enum(["human", "agent"]), id: z.string().min(1) })
  .nullish();

// ─────────────────────────────────────────────────────────────────────────────
// Orientation — what this agent is, and what it can reach
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "whoami",
  "Your own identity: which agent you are, which workspace your token drops you into, and every board you can reach. Call this first in a new session — it is the only way to learn ids you were not told.",
  {},
  () => me()
);

tool(
  "list_boards",
  "Every board in your workspace, with its id and name. Use this instead of assuming the default board is the one you want.",
  {},
  async () => (await me()).boards ?? []
);

tool(
  "list_board",
  "Read a board: its columns and their top-level tasks (each with a subtaskCount), plus the delivery risk currently scored on it. Omit boardId for the default board. Column ids come from here. For a large board prefer search_tasks — this returns everything.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => {
    const id = await board(boardId);
    const [tree, risks] = await Promise.all([
      api("GET", `/api/board/${id}`),
      api("GET", `/api/board/${id}/risk`),
    ]);
    return { ...tree, risks };
  }
);

tool(
  "list_columns",
  "A board's columns alone — id, name, position, WIP limit — without the tasks in them. The cheap read when all you need is where to put something.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => (await api("GET", `/api/board/${await board(boardId)}`)).columns
);

tool(
  "list_assignees",
  "Everyone a task can be assigned to in this workspace: humans and agents, each with the id the assignee field wants. Names only — no email addresses.",
  {},
  async () => api("GET", `/api/workspaces/${await workspaceId()}/assignees`)
);

tool(
  "list_labels",
  "The workspace's label vocabulary — id and name for each. Label ids for create_task/set_labels come from here.",
  {},
  async () => api("GET", `/api/workspaces/${await workspaceId()}/labels`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Finding work
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "search_tasks",
  "Find tasks on a board without reading the whole board. Every filter is optional and they combine (AND). `text` is a case-insensitive substring of title or description. `assignee` takes {type,id}, or the string \"none\" for unassigned. `labelIds` requires ALL of them. Results are newest first, paged: pass the returned nextCursor back as `cursor` until it is null.",
  {
    boardId: z.number().int().optional(),
    text: z.string().optional(),
    columnId: z.number().int().optional(),
    assignee: z
      .union([z.object({ type: z.enum(["human", "agent"]), id: z.string().min(1) }), z.literal("none")])
      .optional(),
    priority: priority.optional(),
    type: taskType.optional(),
    labelIds: z.array(z.number().int()).optional(),
    milestoneId: z.number().int().optional(),
    sprintId: z.number().int().optional(),
    epicId: z.number().int().optional(),
    dueBefore: isoDate.optional(),
    dueAfter: isoDate.optional(),
    includeSubtasks: z.boolean().optional(),
    openOnly: z.boolean().optional().describe("Only tasks outside the board's done column"),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.number().int().optional(),
  },
  async ({ boardId, text, assignee: who, labelIds, ...rest }) => {
    const params = new URLSearchParams();
    if (text) params.set("q", text);
    if (who !== undefined) {
      params.set("assignee", who === "none" ? "none" : `${who.type}:${who.id}`);
    }
    for (const id of labelIds ?? []) params.append("labelId", String(id));
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return api("GET", `/api/board/${await board(boardId)}/tasks/search?${params}`);
  }
);

tool(
  "get_task",
  "Read one task by id, including its current column, priority, due date, labels, checklist progress, subtaskCount, and its delivery risk (null when nothing is firing).",
  { id: z.number().int() },
  // Two calls rather than one, and worth it: an agent deciding what to do with a
  // task needs to know it is late or blocked, and a signal you have to know to
  // ask for is a signal most sessions never see. Door 1's get_task merges the
  // same field — the doors publish one vocabulary or the agent learns two.
  async ({ id }) => ({
    ...(await api("GET", `/api/tasks/${id}`)),
    risk: await api("GET", `/api/tasks/${id}/risk`),
  })
);

tool(
  "task_history",
  "Read a task's activity log — every change to it, newest first, with who did it. Read this before acting on a task someone else may have touched, to see what has already happened.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/activity`)
);

tool(
  "list_subtasks",
  "A task's subtasks — the pieces it was decomposed into, each a whole task with its own status.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/subtasks`)
);

tool(
  "list_comments",
  "A task's comments, oldest first — the discussion around the work, including anything a human asked you.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/comments`)
);

tool(
  "list_dependencies",
  "What a task is blocked by — its blocked-by edges, each naming the task it waits on.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/dependencies`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Changing work
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "create_task",
  "Create a task in a column (get columnId from list_columns). Only title and columnId are required.",
  {
    columnId: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priority.optional(),
    value: z.number().int().min(0).max(10).optional(), // business value 0–10 (034)
    risk: z.number().int().min(0).max(10).optional(), // risk 0–10 (034)
    startDate: isoDate.optional(), // when work begins (032)
    dueDate: isoDate.optional(),
    assignee,
    labelIds: z.array(z.number().int()).optional(),
  },
  (input) => api("POST", "/api/tasks", input)
);

tool(
  "update_task",
  "Edit a task's fields. Only the fields you pass change; omit the rest. Pass null to clear dueDate, startDate, assignee, estimate, milestoneId, value, or risk. type is task|bug|story; estimate is effort in points (0 is valid); milestoneId aims the task at a milestone on its own board (get ids from list_milestones); startDate/dueDate together draw the task's Timeline bar; value/risk are 0–10 and, with estimate, yield the prioritisation score = value / (estimate × (1 + risk/10)).",
  {
    id: z.number().int(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: priority.optional(),
    type: taskType.optional(),
    estimate: z.number().int().min(0).nullish(),
    milestoneId: z.number().int().nullish(),
    sprintId: z.number().int().nullish(),
    epicId: z.number().int().nullish(),
    value: z.number().int().min(0).max(10).nullish(),
    risk: z.number().int().min(0).max(10).nullish(),
    startDate: isoDate.nullish(),
    dueDate: isoDate.nullish(),
    assignee,
    labelIds: z.array(z.number().int()).optional(),
  },
  ({ id, ...patch }) => api("PATCH", `/api/tasks/${id}`, patch)
);

// The single-field tools below are parity with Door 1 (the native runtime's
// tool set), and they exist for a reason beyond convenience: a narrow tool is a
// narrow intent. "assign_task" in a run's history says what the agent meant;
// the same change through update_task is a patch a reader has to diff.
const field = (name, description, schema, toPatch) =>
  tool(name, description, { id: z.number().int(), ...schema }, ({ id, ...rest }) =>
    api("PATCH", `/api/tasks/${id}`, toPatch(rest))
  );

field(
  "assign_task",
  "Assign a task to a person or an agent, or pass null to unassign. Ids come from list_assignees.",
  { assignee },
  ({ assignee: a }) => ({ assignee: a ?? null })
);
field(
  "rename_task",
  "Change a task's title, leaving everything else alone.",
  { title: z.string().min(1) },
  ({ title }) => ({ title })
);
field(
  "set_priority",
  "Set a task's priority.",
  { priority },
  ({ priority: p }) => ({ priority: p })
);
field(
  "set_labels",
  "Replace a task's labels with exactly this set — an empty array clears them. Ids come from list_labels.",
  { labelIds: z.array(z.number().int()) },
  ({ labelIds }) => ({ labelIds })
);
field(
  "set_due_date",
  "Set or clear (null) a task's due date.",
  { dueDate: isoDate.nullable() },
  ({ dueDate }) => ({ dueDate })
);
field(
  "set_estimate",
  "Set or clear (null) a task's effort estimate in points. 0 is a valid estimate; null means unestimated.",
  { estimate: z.number().int().min(0).nullable() },
  ({ estimate }) => ({ estimate })
);
field(
  "set_type",
  "Set a task's type: task, bug, or story.",
  { type: taskType },
  ({ type }) => ({ type })
);
field(
  "score_task",
  "Set a task's prioritisation inputs — business value and risk, each 0–10. With an estimate these yield score = value / (estimate × (1 + risk/10)).",
  { value: z.number().int().min(0).max(10).nullable(), risk: z.number().int().min(0).max(10).nullable() },
  ({ value, risk }) => ({ value, risk })
);
field(
  "aim_at_milestone",
  "Aim a task at a milestone on its own board, or pass null to un-aim it. Ids come from list_milestones.",
  { milestoneId: z.number().int().nullable() },
  ({ milestoneId }) => ({ milestoneId })
);

tool(
  "move_task",
  "Move a task to a column and position — this is how a task's status changes. Get columnId from list_columns; position is 0-based within the destination column.",
  {
    id: z.number().int(),
    columnId: z.number().int(),
    position: z.number().int().min(0),
  },
  ({ id, columnId, position }) => api("PATCH", `/api/tasks/${id}`, { columnId, position })
);

tool(
  "bulk_update_tasks",
  "Apply one edit to up to 100 tasks at once — a column move, an assignee, a priority, or a due date. Each task keeps its own permission check and its own history row, so a partial failure is reported per task rather than rolling the batch back. Deletion is deliberately not offered here.",
  {
    ids: z.array(z.number().int()).min(1).max(100),
    columnId: z.number().int().optional(),
    assignee,
    priority: priority.optional(),
    dueDate: isoDate.nullish(),
  },
  (input) => api("POST", "/api/tasks/bulk", input)
);

tool(
  "claim_task",
  "Claim a task before working it — an exclusive hold that stops another agent grabbing the same one. Take it when you start; a task already claimed by someone else is refused with CONFLICT (do not retry — pick another task). Claiming your own hold again renews the lease. The lease expires, so a crashed agent cannot wedge a task forever; ttlMinutes sets how long you expect to need it.",
  { id: z.number().int(), ttlMinutes: z.number().int().min(1).max(1440).optional() },
  ({ id, ttlMinutes }) =>
    api("POST", `/api/tasks/${id}/claim`, ttlMinutes ? { ttlMinutes } : undefined)
);

tool(
  "release_task",
  "Release your claim on a task — do this when you stop working it or after you close it, so it is free again. Releasing a task you do not hold is a no-op.",
  { id: z.number().int() },
  ({ id }) => api("DELETE", `/api/tasks/${id}/claim`)
);

tool(
  "comment_on_task",
  "Add a comment to a task — the agent's channel for reporting what it did or asking a question. Posts under the agent's name.",
  { id: z.number().int(), body: z.string().min(1) },
  ({ id, body }) => api("POST", `/api/tasks/${id}/comments`, { body })
);

tool(
  "create_subtask",
  "Create a subtask (a piece) under a parent task, for decomposing work. Get columnId from list_columns; a subtask is a whole task with its own status.",
  {
    parentId: z.number().int(),
    columnId: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priority.optional(),
    dueDate: isoDate.optional(),
    assignee,
    labelIds: z.array(z.number().int()).optional(),
  },
  ({ parentId, ...rest }) => api("POST", "/api/tasks", { parentId, ...rest })
);

tool(
  "flag_blocker",
  "Record that a task is blocked by another task on the same board — a blocked-by edge everyone can see. Both ids must be tasks on the same board; a self-reference or a cycle is refused, and re-flagging an existing edge is a harmless no-op.",
  { id: z.number().int(), dependsOnId: z.number().int() },
  ({ id, dependsOnId }) =>
    api("POST", `/api/tasks/${id}/dependencies`, { dependsOnId })
);

tool(
  "unflag_blocker",
  "Remove a blocked-by edge — the blocker no longer blocks this task. Use it when the dependency turned out not to be real, or after the blocker's work was folded in.",
  { id: z.number().int(), dependsOnId: z.number().int() },
  ({ id, dependsOnId }) => api("DELETE", `/api/tasks/${id}/dependencies/${dependsOnId}`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Checklists, custom fields, time
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "get_checklist",
  "A task's checklist — the acceptance criteria or steps, each with a done flag.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/checklist`)
);

tool(
  "add_checklist_item",
  "Append an item to a task's checklist. Use this to record the steps you intend to take, so a human can watch them close.",
  { id: z.number().int(), content: z.string().min(1) },
  ({ id, content }) => api("POST", `/api/tasks/${id}/checklist`, { content })
);

tool(
  "check_item",
  "Tick or untick a checklist item, and optionally reword it. The item id comes from get_checklist, not the task id.",
  {
    itemId: z.number().int(),
    done: z.boolean().optional(),
    content: z.string().min(1).optional(),
  },
  ({ itemId, ...patch }) => api("PATCH", `/api/checklist/${itemId}`, patch)
);

tool(
  "list_custom_fields",
  "The board's custom field definitions — id, name, type, and options for each. Field ids for set_custom_fields come from here.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/custom-fields`)
);

tool(
  "set_custom_fields",
  "Set a task's custom field values. This REPLACES the whole set: read get_task's customFields first and send back everything you want kept, or previously answered fields are cleared.",
  {
    id: z.number().int(),
    values: z.array(
      z.object({ fieldId: z.number().int(), value: z.string() })
    ),
  },
  ({ id, values }) => api("PUT", `/api/tasks/${id}/custom-fields`, { values })
);

tool(
  "get_time_entries",
  "The time logged against a task — who spent how many minutes, when, and on what.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/time`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Planning containers
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "list_milestones",
  "A board's milestones, each with its progress against the board's done column.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/milestones`)
);

tool(
  "list_sprints",
  "A board's sprints — name, goal, window, and status (planning, active, or completed). At most one is active.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/sprints`)
);

tool(
  "add_task_to_sprint",
  "Put a task into a sprint on its own board, or pass null to take it out. Sprint ids come from list_sprints.",
  { id: z.number().int(), sprintId: z.number().int().nullable() },
  ({ id, sprintId }) => api("PATCH", `/api/tasks/${id}`, { sprintId })
);

tool(
  "list_epics",
  "A board's epics — the large bodies of work its tasks roll up into.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/epics`)
);

tool(
  "assign_to_epic",
  "Put a task under an epic on its own board, or pass null to take it out. Epic ids come from list_epics.",
  { id: z.number().int(), epicId: z.number().int().nullable() },
  ({ id, epicId }) => api("PATCH", `/api/tasks/${id}`, { epicId })
);

// ─────────────────────────────────────────────────────────────────────────────
// Reading around the work
// ─────────────────────────────────────────────────────────────────────────────

tool(
  "board_analytics",
  "A board's flow metrics: lead and cycle time, weekly throughput, a 30-day cumulative flow, and per-assignee workload. This is what a standup report is made of — read it rather than counting cards yourself.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/analytics`)
);

tool(
  "propose_schedule",
  "Propose start and due dates for a board's tasks (4.1): dependency-ordered, respecting each assignee's weekly capacity, with the reasons behind each date. A PROPOSAL — this writes nothing. Report it, or set the dates you agree with one at a time with set_due_date, which is a change a human can see and undo. There is deliberately no tool that applies a whole proposed schedule.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/schedule`)
);

tool(
  "score_risk",
  "Delivery risk across a board (4.2): every task showing a signal, highest first, each with a 0–1 score, a low/medium/high level, and the reasons behind it (overdue since a date, blocked by N tasks, open for N days). Deterministic — the score comes from board facts, never from a judgement about the work. Use it to decide what to raise, not as permission to reprioritise.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/risk`)
);

tool(
  "export_board",
  "Export a board as JSON — every task with its fields and subtasks. Large: prefer search_tasks unless you genuinely need the whole board at once.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${await board(boardId)}/export?format=json`)
);

tool(
  "list_attachments",
  "The files attached to a task — name, content type, and size. Metadata only; this does not download bytes.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}/attachments`)
);

tool(
  "get_git_context",
  "A task's git context: the branches, commits, and pull requests linked to it, together with the CI status of each. The first read for a coding agent picking up a task someone already started.",
  { id: z.number().int() },
  async ({ id }) => ({
    links: await api("GET", `/api/tasks/${id}/git-links`),
    ci: await api("GET", `/api/tasks/${id}/ci-status`),
  })
);

tool(
  "get_notifications",
  "Your unread notifications — mentions, assignments, and comments aimed at you. An agent's inbox: check it before deciding there is nothing to do.",
  {},
  async () => api("GET", `/api/workspaces/${await workspaceId()}/notifications`)
);

tool(
  "mark_notifications_seen",
  "Mark your notifications as seen, so the next get_notifications shows only what arrived since.",
  {},
  async () => api("POST", `/api/workspaces/${await workspaceId()}/notifications/seen`, {})
);

tool(
  "knowledge_query",
  "Ask the workspace's knowledge base a question in plain language — it searches published docs and returns the passages that answer it, with their sources. Use this before asking a human something the docs already say.",
  { question: z.string().min(1) },
  async ({ question }) =>
    api("POST", `/api/workspaces/${await workspaceId()}/knowledge-query`, { question })
);

// ─────────────────────────────────────────────────────────────────────────────
// Resources and prompts — the two MCP surfaces this server had none of
// ─────────────────────────────────────────────────────────────────────────────

// A resource is a thing a client can attach to context without spending a tool
// call on it. The board and the task are the two the agent re-reads constantly.
server.registerResource(
  "board",
  new ResourceTemplate(
    "kanban://board/{boardId}",
    { list: undefined }
  ),
  { description: "A board with its columns and tasks", mimeType: "application/json" },
  async (uri, { boardId }) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await api("GET", `/api/board/${await board(Number(boardId))}`), null, 2),
      },
    ],
  })
);

server.registerResource(
  "task",
  new ResourceTemplate(
    "kanban://task/{taskId}",
    { list: undefined }
  ),
  { description: "One task with its fields", mimeType: "application/json" },
  async (uri, { taskId }) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await api("GET", `/api/tasks/${Number(taskId)}`), null, 2),
      },
    ],
  })
);

// The claim→history→act→comment→release loop, written down once here instead of
// being re-derived by every agent that connects. It is the protocol the whole
// claim model assumes and the thing agents most reliably get wrong (acting on a
// task they never claimed, or claiming one and never releasing it).
server.registerPrompt(
  "work_task",
  {
    description: "The safe loop for taking a task from claimed to released",
    argsSchema: { taskId: z.string().describe("The id of the task to work") },
  },
  ({ taskId }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Work task ${taskId} on the kanban board, following this loop exactly:\n\n` +
            `1. claim_task ${taskId}. If it answers CONFLICT, someone else holds it — stop and pick another task.\n` +
            `2. get_task and task_history for ${taskId}, and list_comments — find out what has already happened before doing anything.\n` +
            `3. get_checklist. If the task has no checklist, add_checklist_item for each step you intend to take.\n` +
            `4. Do the work. Tick each item with check_item as you finish it.\n` +
            `5. comment_on_task with what you did and anything a human needs to decide.\n` +
            `6. move_task to the appropriate column.\n` +
            `7. release_task — always, including when you are stopping without finishing.\n\n` +
            `If any tool answers HELD_FOR_REVIEW, the change was recorded as a proposal for a human ` +
            `to accept. Do not retry it; say so in your comment and carry on.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "triage_board",
  {
    description: "Survey a board and propose what to work on next",
    argsSchema: { boardId: z.string().optional().describe("Defaults to your default board") },
  },
  ({ boardId }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Triage the kanban board${boardId ? ` #${boardId}` : ""}:\n\n` +
            `1. board_analytics for the flow picture — where work is piling up.\n` +
            `2. search_tasks with openOnly and no assignee (assignee: "none") for unclaimed work.\n` +
            `3. search_tasks with dueBefore set to today for anything overdue.\n` +
            `4. For each candidate, list_dependencies — a task blocked by open work is not ready.\n\n` +
            `Report: what is overdue, what is blocked and by what, and the three tasks you would ` +
            `take next with your reason. Do not claim or change anything.`,
        },
      },
    ],
  })
);

await server.connect(new StdioServerTransport());
console.error(`kanban MCP server v${VERSION} ready → ${BASE}`);
