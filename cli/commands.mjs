// The kanban CLI command table — every command is one row: noun, verb,
// positionals, flags, and a run() that is one or two REST calls. The
// dispatcher in kanban.mjs owns parsing, output, and exit codes; nothing
// here prints or exits. The vocabulary mirrors the MCP tool surface
// (mcp/server.mjs) noun-verb style, so the MCP reference doubles as the
// semantic reference for this file.
//
// Conventions:
// - flag meta: { type, multiple, int, desc, required } — `type` feeds
//   node:util parseArgs; `int` coerces after parsing.
// - positional meta: { name, required, int }
// - nullable fields accept the literal string "null" to clear.
// - run(ctx, pos, opts) returns { status, data } from ctx.api / ctx.create.

const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UsageError(`${name} must be an integer, got "${v}"`);
  return n;
};

export class UsageError extends Error {}

// "null" → null for nullable fields, integer otherwise.
const intOrNull = (v, name) => (v === "null" ? null : int(v, name));

const PRIORITIES = ["none", "low", "medium", "high", "urgent"];
const TYPES = ["task", "bug", "story"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (v, name) => {
  if (v === "null") return null;
  if (!DATE_RE.test(v)) throw new UsageError(`${name} must be YYYY-MM-DD or null, got "${v}"`);
  return v;
};

const oneOf = (v, list, name) => {
  if (!list.includes(v)) throw new UsageError(`${name} must be one of ${list.join("|")}, got "${v}"`);
  return v;
};

// --human <id> / --agent <id> / --unassign → the API's assignee shape.
function assigneeFrom(opts, { required = false } = {}) {
  const picked = [opts.human, opts.agent, opts.unassign].filter((v) => v !== undefined);
  if (picked.length > 1) throw new UsageError("pass only one of --human, --agent, --unassign");
  if (opts.human) return { type: "human", id: opts.human };
  if (opts.agent) return { type: "agent", id: opts.agent };
  if (opts.unassign) return null;
  if (required) throw new UsageError("pass one of --human <id>, --agent <id>, --unassign");
  return undefined;
}

const ASSIGNEE_FLAGS = {
  human: { type: "string", desc: "Assign to a person (id from `kanban assignee list`)" },
  agent: { type: "string", desc: "Assign to an agent (id from `kanban assignee list`)" },
  unassign: { type: "boolean", desc: "Clear the assignee" },
};

const TASK_FIELD_FLAGS = {
  title: { type: "string", desc: "Task title" },
  description: { type: "string", desc: "Task description" },
  priority: { type: "string", desc: `Priority: ${PRIORITIES.join("|")}` },
  type: { type: "string", desc: `Type: ${TYPES.join("|")}` },
  estimate: { type: "string", desc: "Effort in points (0 valid, null clears)" },
  value: { type: "string", desc: "Business value 0-10 (null clears)" },
  risk: { type: "string", desc: "Risk 0-10 (null clears)" },
  start: { type: "string", desc: "Start date YYYY-MM-DD (null clears)" },
  due: { type: "string", desc: "Due date YYYY-MM-DD (null clears)" },
  milestone: { type: "string", desc: "Milestone id (null clears)" },
  sprint: { type: "string", desc: "Sprint id (null clears)" },
  epic: { type: "string", desc: "Epic id (null clears)" },
  label: { type: "string", multiple: true, desc: "Label id; repeatable — replaces the whole set" },
  ...ASSIGNEE_FLAGS,
};

// Collect TASK_FIELD_FLAGS values into a PATCH body, only fields present.
function taskPatch(opts) {
  const patch = {};
  if (opts.title !== undefined) patch.title = opts.title;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.priority !== undefined) patch.priority = oneOf(opts.priority, PRIORITIES, "--priority");
  if (opts.type !== undefined) patch.type = oneOf(opts.type, TYPES, "--type");
  if (opts.estimate !== undefined) patch.estimate = intOrNull(opts.estimate, "--estimate");
  if (opts.value !== undefined) patch.value = intOrNull(opts.value, "--value");
  if (opts.risk !== undefined) patch.risk = intOrNull(opts.risk, "--risk");
  if (opts.start !== undefined) patch.startDate = isoDate(opts.start, "--start");
  if (opts.due !== undefined) patch.dueDate = isoDate(opts.due, "--due");
  if (opts.milestone !== undefined) patch.milestoneId = intOrNull(opts.milestone, "--milestone");
  if (opts.sprint !== undefined) patch.sprintId = intOrNull(opts.sprint, "--sprint");
  if (opts.epic !== undefined) patch.epicId = intOrNull(opts.epic, "--epic");
  if (opts.label !== undefined) patch.labelIds = opts.label.map((l) => int(l, "--label"));
  const who = assigneeFrom(opts);
  if (who !== undefined) patch.assignee = who;
  return patch;
}

// One row per command. `mutating` gates --dry-run (commands the server cannot
// dry-run — claim, release, bulk — say so instead of sending a header the
// server refuses).
export const COMMANDS = [
  // ── Orientation ────────────────────────────────────────────────────────
  {
    noun: "me",
    verb: null,
    desc: "Your identity: agent, workspace, and reachable boards.",
    run: async (ctx) => ({ status: 200, data: await ctx.me() }),
  },

  // ── Board ──────────────────────────────────────────────────────────────
  {
    noun: "board",
    verb: "list",
    desc: "Every board in the workspace.",
    run: async (ctx) => ({ status: 200, data: (await ctx.me()).boards ?? [] }),
  },
  {
    noun: "board",
    verb: "show",
    desc: "A board's columns and top-level tasks, plus current risk.",
    run: async (ctx) => {
      const id = await ctx.boardId();
      const [tree, risks] = await Promise.all([
        ctx.api("GET", `/api/board/${id}`),
        ctx.api("GET", `/api/board/${id}/risk`),
      ]);
      return { status: 200, data: { ...tree.data, risks: risks.data } };
    },
  },
  {
    noun: "board",
    verb: "columns",
    desc: "A board's columns alone — id, name, position, WIP limit.",
    run: async (ctx) => {
      const r = await ctx.api("GET", `/api/board/${await ctx.boardId()}`);
      return { status: 200, data: r.data.columns };
    },
  },
  {
    noun: "board",
    verb: "analytics",
    desc: "Flow metrics: lead/cycle time, throughput, cumulative flow, workload.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/analytics`),
  },
  {
    noun: "board",
    verb: "risk",
    desc: "Delivery-risk signals across the board, highest first.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/risk`),
  },
  {
    noun: "board",
    verb: "schedule",
    desc: "A dependency- and capacity-aware schedule PROPOSAL. Writes nothing.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/schedule`),
  },
  {
    noun: "board",
    verb: "export",
    desc: "Full board export as JSON. Large — prefer `task search`.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/export?format=json`),
  },
  {
    noun: "board",
    verb: "events",
    desc: "Bounded long poll for board activity. First call without --since returns a cursor; pass it back. Empty answer: wait again with the SAME cursor.",
    flags: {
      since: { type: "string", desc: "Cursor from the previous call" },
      wait: { type: "string", desc: "Seconds to hold open (default 20, max 25)" },
      limit: { type: "string", desc: "Max events" },
    },
    run: async (ctx, _pos, opts) => {
      const wait = opts.wait !== undefined ? int(opts.wait, "--wait") : 20;
      const params = new URLSearchParams({ wait: String(wait) });
      if (opts.since !== undefined) params.set("since", opts.since);
      if (opts.limit !== undefined) params.set("limit", String(int(opts.limit, "--limit")));
      return ctx.api("GET", `/api/board/${await ctx.boardId()}/events?${params}`, undefined, {
        retries: 0,
        timeout: (wait + 10) * 1000,
      });
    },
  },

  // ── Task: reads ────────────────────────────────────────────────────────
  {
    noun: "task",
    verb: "get",
    desc: "One task with its fields, claim state, and delivery risk.",
    positionals: [{ name: "id", required: true, int: true }],
    run: async (ctx, [id]) => {
      const [task, risk] = await Promise.all([
        ctx.api("GET", `/api/tasks/${id}`),
        ctx.api("GET", `/api/tasks/${id}/risk`),
      ]);
      return { status: 200, data: { ...task.data, risk: risk.data } };
    },
  },
  {
    noun: "task",
    verb: "search",
    desc: "Find tasks. Filters AND together; results paged via --cursor.",
    flags: {
      text: { type: "string", desc: "Substring of title or description" },
      column: { type: "string", desc: "Column id" },
      priority: { type: "string", desc: `Priority: ${PRIORITIES.join("|")}` },
      type: { type: "string", desc: `Type: ${TYPES.join("|")}` },
      label: { type: "string", multiple: true, desc: "Label id; repeatable, requires ALL" },
      milestone: { type: "string", desc: "Milestone id" },
      sprint: { type: "string", desc: "Sprint id" },
      epic: { type: "string", desc: "Epic id" },
      "due-before": { type: "string", desc: "YYYY-MM-DD" },
      "due-after": { type: "string", desc: "YYYY-MM-DD" },
      subtasks: { type: "boolean", desc: "Include subtasks" },
      open: { type: "boolean", desc: "Only tasks outside the done column" },
      limit: { type: "string", desc: "Page size (max 200)" },
      cursor: { type: "string", desc: "nextCursor from the previous page" },
      human: { type: "string", desc: "Assigned to this person id" },
      agent: { type: "string", desc: "Assigned to this agent id" },
      unassigned: { type: "boolean", desc: "Only unassigned tasks" },
    },
    run: async (ctx, _pos, opts) => {
      const params = new URLSearchParams();
      if (opts.text) params.set("q", opts.text);
      if (opts.column !== undefined) params.set("columnId", String(int(opts.column, "--column")));
      if (opts.priority !== undefined) params.set("priority", oneOf(opts.priority, PRIORITIES, "--priority"));
      if (opts.type !== undefined) params.set("type", oneOf(opts.type, TYPES, "--type"));
      for (const l of opts.label ?? []) params.append("labelId", String(int(l, "--label")));
      if (opts.milestone !== undefined) params.set("milestoneId", String(int(opts.milestone, "--milestone")));
      if (opts.sprint !== undefined) params.set("sprintId", String(int(opts.sprint, "--sprint")));
      if (opts.epic !== undefined) params.set("epicId", String(int(opts.epic, "--epic")));
      if (opts["due-before"] !== undefined) params.set("dueBefore", isoDate(opts["due-before"], "--due-before"));
      if (opts["due-after"] !== undefined) params.set("dueAfter", isoDate(opts["due-after"], "--due-after"));
      if (opts.subtasks) params.set("includeSubtasks", "true");
      if (opts.open) params.set("openOnly", "true");
      if (opts.limit !== undefined) params.set("limit", String(int(opts.limit, "--limit")));
      if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
      if (opts.unassigned) params.set("assignee", "none");
      else if (opts.human) params.set("assignee", `human:${opts.human}`);
      else if (opts.agent) params.set("assignee", `agent:${opts.agent}`);
      return ctx.api("GET", `/api/board/${await ctx.boardId()}/tasks/search?${params}`);
    },
  },
  {
    noun: "task",
    verb: "history",
    desc: "A task's activity log, newest first.",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("GET", `/api/tasks/${id}/activity`),
  },
  {
    noun: "task",
    verb: "comments",
    desc: "A task's comment thread, oldest first.",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("GET", `/api/tasks/${id}/comments`),
  },
  {
    noun: "task",
    verb: "subtasks",
    desc: "A task's subtasks.",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("GET", `/api/tasks/${id}/subtasks`),
  },
  {
    noun: "task",
    verb: "attachments",
    desc: "Attachment metadata for a task (no bytes).",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("GET", `/api/tasks/${id}/attachments`),
  },
  {
    noun: "task",
    verb: "git",
    desc: "Linked branches, commits, and PRs, with CI status.",
    positionals: [{ name: "id", required: true, int: true }],
    run: async (ctx, [id]) => {
      const [links, ci] = await Promise.all([
        ctx.api("GET", `/api/tasks/${id}/git-links`),
        ctx.api("GET", `/api/tasks/${id}/ci-status`),
      ]);
      return { status: 200, data: { links: links.data, ci: ci.data } };
    },
  },
  {
    noun: "task",
    verb: "time",
    desc: "Time entries logged against a task.",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("GET", `/api/tasks/${id}/time`),
  },

  // ── Task: mutations ────────────────────────────────────────────────────
  {
    noun: "task",
    verb: "create",
    desc: "Create a task. Requires --column and --title.",
    mutating: true,
    flags: {
      column: { type: "string", required: true, desc: "Column id (from `kanban board columns`)" },
      ...TASK_FIELD_FLAGS,
    },
    run: (ctx, _pos, opts) => {
      if (!opts.title) throw new UsageError("--title is required");
      return ctx.create("/api/tasks", {
        columnId: int(opts.column, "--column"),
        ...taskPatch(opts),
      }, opts["idempotency-key"]);
    },
  },
  {
    noun: "task",
    verb: "update",
    desc: "Edit task fields. Only passed flags change; \"null\" clears a nullable field.",
    mutating: true,
    positionals: [{ name: "id", required: true, int: true }],
    flags: TASK_FIELD_FLAGS,
    run: (ctx, [id], opts) => {
      const patch = taskPatch(opts);
      if (Object.keys(patch).length === 0) throw new UsageError("nothing to change — pass at least one field flag");
      return ctx.api("PATCH", `/api/tasks/${id}`, patch);
    },
  },
  {
    noun: "task",
    verb: "move",
    desc: "Move a task to a column (0-based --position, default 0).",
    mutating: true,
    positionals: [{ name: "id", required: true, int: true }],
    flags: {
      column: { type: "string", required: true, desc: "Destination column id" },
      position: { type: "string", desc: "0-based position in the column (default 0)" },
    },
    run: (ctx, [id], opts) =>
      ctx.api("PATCH", `/api/tasks/${id}`, {
        columnId: int(opts.column, "--column"),
        position: opts.position !== undefined ? int(opts.position, "--position") : 0,
      }),
  },
  {
    noun: "task",
    verb: "rename",
    desc: "Change a task's title.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "title", required: true },
    ],
    run: (ctx, [id, title]) => ctx.api("PATCH", `/api/tasks/${id}`, { title }),
  },
  {
    noun: "task",
    verb: "assign",
    desc: "Assign a task to a person or agent, or clear it.",
    mutating: true,
    positionals: [{ name: "id", required: true, int: true }],
    flags: ASSIGNEE_FLAGS,
    run: (ctx, [id], opts) =>
      ctx.api("PATCH", `/api/tasks/${id}`, { assignee: assigneeFrom(opts, { required: true }) }),
  },
  {
    noun: "task",
    verb: "priority",
    desc: "Set a task's priority.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "priority", required: true },
    ],
    run: (ctx, [id, p]) =>
      ctx.api("PATCH", `/api/tasks/${id}`, { priority: oneOf(p, PRIORITIES, "priority") }),
  },
  {
    noun: "task",
    verb: "type",
    desc: "Set a task's type: task, bug, or story.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "type", required: true },
    ],
    run: (ctx, [id, t]) => ctx.api("PATCH", `/api/tasks/${id}`, { type: oneOf(t, TYPES, "type") }),
  },
  {
    noun: "task",
    verb: "due",
    desc: "Set or clear a task's due date.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "date", required: true },
    ],
    run: (ctx, [id, d]) => ctx.api("PATCH", `/api/tasks/${id}`, { dueDate: isoDate(d, "date") }),
  },
  {
    noun: "task",
    verb: "estimate",
    desc: "Set or clear a task's effort estimate in points.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "points", required: true },
    ],
    run: (ctx, [id, e]) => ctx.api("PATCH", `/api/tasks/${id}`, { estimate: intOrNull(e, "points") }),
  },
  {
    noun: "task",
    verb: "labels",
    desc: "Replace a task's labels with exactly the given set; --clear empties it.",
    mutating: true,
    positionals: [{ name: "id", required: true, int: true }],
    flags: {
      label: { type: "string", multiple: true, desc: "Label id; repeatable" },
      clear: { type: "boolean", desc: "Remove all labels" },
    },
    run: (ctx, [id], opts) => {
      if (!opts.clear && !opts.label?.length) throw new UsageError("pass --label <id> (repeatable) or --clear");
      return ctx.api("PATCH", `/api/tasks/${id}`, {
        labelIds: opts.clear ? [] : opts.label.map((l) => int(l, "--label")),
      });
    },
  },
  {
    noun: "task",
    verb: "score",
    desc: "Set prioritisation inputs: business value and risk, each 0-10 or null.",
    mutating: true,
    positionals: [{ name: "id", required: true, int: true }],
    flags: {
      value: { type: "string", desc: "Business value 0-10 (null clears)" },
      risk: { type: "string", desc: "Risk 0-10 (null clears)" },
    },
    run: (ctx, [id], opts) => {
      if (opts.value === undefined && opts.risk === undefined)
        throw new UsageError("pass --value and/or --risk");
      const patch = {};
      if (opts.value !== undefined) patch.value = intOrNull(opts.value, "--value");
      if (opts.risk !== undefined) patch.risk = intOrNull(opts.risk, "--risk");
      return ctx.api("PATCH", `/api/tasks/${id}`, patch);
    },
  },
  {
    noun: "task",
    verb: "milestone",
    desc: "Aim a task at a milestone on its board, or \"null\" to un-aim.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "milestoneId", required: true },
    ],
    run: (ctx, [id, m]) => ctx.api("PATCH", `/api/tasks/${id}`, { milestoneId: intOrNull(m, "milestoneId") }),
  },
  {
    noun: "task",
    verb: "sprint",
    desc: "Put a task into a sprint, or \"null\" to take it out.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "sprintId", required: true },
    ],
    run: (ctx, [id, s]) => ctx.api("PATCH", `/api/tasks/${id}`, { sprintId: intOrNull(s, "sprintId") }),
  },
  {
    noun: "task",
    verb: "epic",
    desc: "Put a task under an epic, or \"null\" to take it out.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "epicId", required: true },
    ],
    run: (ctx, [id, e]) => ctx.api("PATCH", `/api/tasks/${id}`, { epicId: intOrNull(e, "epicId") }),
  },
  {
    noun: "task",
    verb: "claim",
    desc: "Take an exclusive expiring hold before working a task. CONFLICT (exit 5) means someone else holds it — pick other work, do not retry.",
    positionals: [{ name: "id", required: true, int: true }],
    flags: { ttl: { type: "string", desc: "Lease minutes (1-1440)" } },
    run: (ctx, [id], opts) =>
      ctx.api(
        "POST",
        `/api/tasks/${id}/claim`,
        opts.ttl !== undefined ? { ttlMinutes: int(opts.ttl, "--ttl") } : undefined
      ),
  },
  {
    noun: "task",
    verb: "release",
    desc: "Release your claim. Releasing a task you do not hold is a no-op.",
    positionals: [{ name: "id", required: true, int: true }],
    run: (ctx, [id]) => ctx.api("DELETE", `/api/tasks/${id}/claim`),
  },
  {
    noun: "task",
    verb: "comment",
    desc: "Add a comment to a task.",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "body", required: true },
    ],
    run: (ctx, [id, body], opts) => ctx.create(`/api/tasks/${id}/comments`, { body }, opts["idempotency-key"]),
  },
  {
    noun: "task",
    verb: "bulk",
    desc: "Apply one edit to up to 100 tasks. Partial failure is reported per task. No dry run.",
    flags: {
      ids: { type: "string", required: true, desc: "Comma-separated task ids" },
      column: { type: "string", desc: "Destination column id" },
      priority: { type: "string", desc: `Priority: ${PRIORITIES.join("|")}` },
      due: { type: "string", desc: "Due date YYYY-MM-DD (null clears)" },
      ...ASSIGNEE_FLAGS,
    },
    run: (ctx, _pos, opts) => {
      const body = { ids: opts.ids.split(",").map((s) => int(s.trim(), "--ids")) };
      if (opts.column !== undefined) body.columnId = int(opts.column, "--column");
      if (opts.priority !== undefined) body.priority = oneOf(opts.priority, PRIORITIES, "--priority");
      if (opts.due !== undefined) body.dueDate = isoDate(opts.due, "--due");
      const who = assigneeFrom(opts);
      if (who !== undefined) body.assignee = who;
      if (Object.keys(body).length === 1) throw new UsageError("pass at least one edit flag");
      return ctx.api("POST", "/api/tasks/bulk", body);
    },
  },

  // ── Subtask ────────────────────────────────────────────────────────────
  {
    noun: "subtask",
    verb: "create",
    desc: "Create a subtask under a parent task.",
    mutating: true,
    positionals: [{ name: "parentId", required: true, int: true }],
    flags: {
      column: { type: "string", required: true, desc: "Column id" },
      ...TASK_FIELD_FLAGS,
    },
    run: (ctx, [parentId], opts) => {
      if (!opts.title) throw new UsageError("--title is required");
      return ctx.create("/api/tasks", {
        parentId,
        columnId: int(opts.column, "--column"),
        ...taskPatch(opts),
      }, opts["idempotency-key"]);
    },
  },

  // ── Checklist ──────────────────────────────────────────────────────────
  {
    noun: "checklist",
    verb: "show",
    desc: "A task's checklist items with done flags.",
    positionals: [{ name: "taskId", required: true, int: true }],
    run: (ctx, [taskId]) => ctx.api("GET", `/api/tasks/${taskId}/checklist`),
  },
  {
    noun: "checklist",
    verb: "add",
    desc: "Append an item to a task's checklist.",
    mutating: true,
    positionals: [
      { name: "taskId", required: true, int: true },
      { name: "content", required: true },
    ],
    run: (ctx, [taskId, content], opts) =>
      ctx.create(`/api/tasks/${taskId}/checklist`, { content }, opts["idempotency-key"]),
  },
  {
    noun: "checklist",
    verb: "check",
    desc: "Tick a checklist item (by ITEM id, from `checklist show`). --undo unticks; --content rewords.",
    mutating: true,
    positionals: [{ name: "itemId", required: true, int: true }],
    flags: {
      undo: { type: "boolean", desc: "Untick instead of tick" },
      content: { type: "string", desc: "New wording" },
    },
    run: (ctx, [itemId], opts) => {
      const patch = { done: !opts.undo };
      if (opts.content !== undefined) patch.content = opts.content;
      return ctx.api("PATCH", `/api/checklist/${itemId}`, patch);
    },
  },

  // ── Dependencies ───────────────────────────────────────────────────────
  {
    noun: "dependency",
    verb: "list",
    desc: "What a task is blocked by: edges with type (FS/SS/FF) and lag.",
    positionals: [{ name: "taskId", required: true, int: true }],
    run: (ctx, [taskId]) => ctx.api("GET", `/api/tasks/${taskId}/dependencies`),
  },
  {
    noun: "dependency",
    verb: "add",
    desc: "Record that a task is blocked by another (same board; no self-refs or cycles).",
    mutating: true,
    positionals: [
      { name: "taskId", required: true, int: true },
      { name: "dependsOnId", required: true, int: true },
    ],
    flags: {
      type: { type: "string", desc: "FS (default) | SS | FF" },
      lag: { type: "string", desc: "Signed lag in days" },
    },
    run: (ctx, [taskId, dependsOnId], opts) => {
      const body = { dependsOnId };
      if (opts.type !== undefined) body.type = oneOf(opts.type, ["FS", "SS", "FF"], "--type");
      if (opts.lag !== undefined) body.lagDays = int(opts.lag, "--lag");
      return ctx.create(`/api/tasks/${taskId}/dependencies`, body, opts["idempotency-key"]);
    },
  },
  {
    noun: "dependency",
    verb: "remove",
    desc: "Remove a blocked-by edge.",
    mutating: true,
    positionals: [
      { name: "taskId", required: true, int: true },
      { name: "dependsOnId", required: true, int: true },
    ],
    run: (ctx, [taskId, dependsOnId]) =>
      ctx.api("DELETE", `/api/tasks/${taskId}/dependencies/${dependsOnId}`),
  },

  // ── Workspace vocabulary ───────────────────────────────────────────────
  {
    noun: "label",
    verb: "list",
    desc: "The workspace's labels — id and name.",
    run: async (ctx) => ctx.api("GET", `/api/workspaces/${await ctx.workspaceId()}/labels`),
  },
  {
    noun: "assignee",
    verb: "list",
    desc: "Everyone a task can be assigned to: humans and agents with ids.",
    run: async (ctx) => ctx.api("GET", `/api/workspaces/${await ctx.workspaceId()}/assignees`),
  },
  {
    noun: "field",
    verb: "list",
    desc: "The board's custom field definitions.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/custom-fields`),
  },
  {
    noun: "field",
    verb: "set",
    desc: "Set a task's custom fields. REPLACES the whole set — send back everything you want kept.",
    mutating: true,
    positionals: [{ name: "taskId", required: true, int: true }],
    flags: {
      value: {
        type: "string",
        multiple: true,
        required: true,
        desc: "fieldId=value; repeatable",
      },
    },
    run: (ctx, [taskId], opts) => {
      const values = opts.value.map((pair) => {
        const eq = pair.indexOf("=");
        if (eq < 1) throw new UsageError(`--value must be fieldId=value, got "${pair}"`);
        return { fieldId: int(pair.slice(0, eq), "--value fieldId"), value: pair.slice(eq + 1) };
      });
      return ctx.api("PUT", `/api/tasks/${taskId}/custom-fields`, { values });
    },
  },

  // ── Planning containers ────────────────────────────────────────────────
  {
    noun: "milestone",
    verb: "list",
    desc: "A board's milestones with progress.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/milestones`),
  },
  {
    noun: "sprint",
    verb: "list",
    desc: "A board's sprints — goal, window, status.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/sprints`),
  },
  {
    noun: "epic",
    verb: "list",
    desc: "A board's epics with owner, status, progress, and derived window.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/epics`),
  },
  {
    noun: "epic",
    verb: "set",
    desc: "Create an epic (no --id) or edit one (--id). Consequential: held for review by default.",
    mutating: true,
    flags: {
      id: { type: "string", desc: "Epic id to edit; omit to create" },
      name: { type: "string", desc: "Epic name" },
      status: { type: "string", desc: "proposed|active|paused|done" },
      owner: { type: "string", desc: "Owner member id (null clears)" },
    },
    run: async (ctx, _pos, opts) => {
      const fields = {};
      if (opts.name !== undefined) fields.name = opts.name;
      if (opts.status !== undefined)
        fields.status = oneOf(opts.status, ["proposed", "active", "paused", "done"], "--status");
      if (opts.owner !== undefined) fields.ownerId = opts.owner === "null" ? null : opts.owner;
      if (Object.keys(fields).length === 0) throw new UsageError("pass at least one of --name, --status, --owner");
      return opts.id === undefined
        ? ctx.api("POST", `/api/board/${await ctx.boardId()}/epics`, fields)
        : ctx.api("PATCH", `/api/epics/${int(opts.id, "--id")}`, fields);
    },
  },
  {
    noun: "objective",
    verb: "list",
    desc: "A board's objectives and key results with rolled-up progress.",
    run: async (ctx) => ctx.api("GET", `/api/board/${await ctx.boardId()}/objectives`),
  },
  {
    noun: "objective",
    verb: "set",
    desc: "Create an objective (no --id) or edit one (--id). Consequential: held for review by default.",
    mutating: true,
    flags: {
      id: { type: "string", desc: "Objective id to edit; omit to create" },
      name: { type: "string", desc: "Objective name" },
      description: { type: "string", desc: "Description" },
      due: { type: "string", desc: "Due date YYYY-MM-DD (null clears)" },
    },
    run: async (ctx, _pos, opts) => {
      const fields = {};
      if (opts.name !== undefined) fields.name = opts.name;
      if (opts.description !== undefined) fields.description = opts.description;
      if (opts.due !== undefined) fields.dueDate = isoDate(opts.due, "--due");
      if (Object.keys(fields).length === 0)
        throw new UsageError("pass at least one of --name, --description, --due");
      return opts.id === undefined
        ? ctx.api("POST", `/api/board/${await ctx.boardId()}/objectives`, fields)
        : ctx.api("PATCH", `/api/objectives/${int(opts.id, "--id")}`, fields);
    },
  },
  {
    noun: "kr",
    verb: "score",
    desc: "Record a key result's current value (the measurement, not the target).",
    mutating: true,
    positionals: [
      { name: "id", required: true, int: true },
      { name: "currentValue", required: true },
    ],
    run: (ctx, [id, v]) => {
      const n = Number(v);
      if (Number.isNaN(n)) throw new UsageError(`currentValue must be a number, got "${v}"`);
      return ctx.api("PATCH", `/api/key-results/${id}`, { currentValue: n });
    },
  },

  // ── Inbox and knowledge ────────────────────────────────────────────────
  {
    noun: "notify",
    verb: "list",
    desc: "Unread notifications aimed at you.",
    run: async (ctx) => ctx.api("GET", `/api/workspaces/${await ctx.workspaceId()}/notifications`),
  },
  {
    noun: "notify",
    verb: "seen",
    desc: "Mark notifications as seen.",
    run: async (ctx) =>
      ctx.api("POST", `/api/workspaces/${await ctx.workspaceId()}/notifications/seen`, {}),
  },
  {
    noun: "knowledge",
    verb: null,
    desc: "Ask the workspace knowledge base a question in plain language.",
    positionals: [{ name: "question", required: true }],
    run: async (ctx, [question]) =>
      ctx.api("POST", `/api/workspaces/${await ctx.workspaceId()}/knowledge-query`, { question }),
  },
];
