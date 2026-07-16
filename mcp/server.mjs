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
// stdout is the MCP transport — never write to it. Diagnostics go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

/** One authenticated REST call. Throws the server's own error message on failure. */
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-agent-key": KEY,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null; // 204 (delete) has no body
  if (!res.ok) {
    throw new Error(data?.error ?? `${method} ${path} failed (${res.status})`);
  }
  return data;
}

// /api/agent/me is fetched at most once — it names the agent's workspace and its
// boards, so tools can default to a real board without the operator wiring ids.
let mePromise;
const me = () => (mePromise ??= api("GET", "/api/agent/me"));
async function defaultBoardId() {
  const info = await me();
  if (!info.boards?.length) throw new Error("This agent's workspace has no boards.");
  return info.boards[0].id;
}

const server = new McpServer({ name: "kanban", version: "0.1.0" });

const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** Register a tool whose body is one REST call; surface errors as tool errors. */
function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return ok(await run(args ?? {}));
    } catch (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
  });
}

const priority = z.enum(["none", "low", "medium", "high", "urgent"]);

tool(
  "list_board",
  "Read a board: its columns and their top-level tasks (each with a subtaskCount). Omit boardId for the workspace's first board. Column ids come from here.",
  { boardId: z.number().int().optional() },
  async ({ boardId }) => api("GET", `/api/board/${boardId ?? (await defaultBoardId())}`)
);

tool(
  "get_task",
  "Read one task by id, including its current column, priority, due date, labels, and subtaskCount.",
  { id: z.number().int() },
  ({ id }) => api("GET", `/api/tasks/${id}`)
);

tool(
  "create_task",
  "Create a task in a column (get columnId from list_board). Only title and columnId are required.",
  {
    columnId: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priority.optional(),
    dueDate: z.string().optional(), // YYYY-MM-DD
    assigneeId: z.string().nullish(),
    labelIds: z.array(z.number().int()).optional(),
  },
  (input) => api("POST", "/api/tasks", input)
);

tool(
  "update_task",
  "Edit a task's fields. Only the fields you pass change; omit the rest. Pass null to clear dueDate or assigneeId.",
  {
    id: z.number().int(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: priority.optional(),
    dueDate: z.string().nullish(),
    assigneeId: z.string().nullish(),
    labelIds: z.array(z.number().int()).optional(),
  },
  ({ id, ...patch }) => api("PATCH", `/api/tasks/${id}`, patch)
);

tool(
  "move_task",
  "Move a task to a column and position — this is how a task's status changes. Get columnId from list_board; position is 0-based within the destination column.",
  {
    id: z.number().int(),
    columnId: z.number().int(),
    position: z.number().int().min(0),
  },
  ({ id, columnId, position }) => api("PATCH", `/api/tasks/${id}`, { columnId, position })
);

tool(
  "comment_on_task",
  "Add a comment to a task — the agent's channel for reporting what it did or asking a question. Posts under the agent's name.",
  { id: z.number().int(), body: z.string().min(1) },
  ({ id, body }) => api("POST", `/api/tasks/${id}/comments`, { body })
);

tool(
  "create_subtask",
  "Create a subtask (a piece) under a parent task, for decomposing work. Get columnId from list_board; a subtask is a whole task with its own status.",
  {
    parentId: z.number().int(),
    columnId: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priority.optional(),
    dueDate: z.string().optional(),
    assigneeId: z.string().nullish(),
    labelIds: z.array(z.number().int()).optional(),
  },
  ({ parentId, ...rest }) => api("POST", "/api/tasks", { parentId, ...rest })
);

await server.connect(new StdioServerTransport());
console.error(`kanban MCP server ready → ${BASE}`);
