#!/usr/bin/env node
// The kanban CLI — "Door 4". A noun-verb front end over the same REST API the
// web UI, MCP server, and raw HTTP door use, authenticated as a workspace
// agent via KANBAN_AGENT_KEY. All logic lives server-side; this file parses
// arguments, calls one command row from commands.mjs, prints, and exits.
//
//   KANBAN_URL=http://localhost:3000 KANBAN_AGENT_KEY=kbn_… kanban me
//
// The exit code is the contract with scripts:
//   0  applied / read OK
//   1  error (network, server, auth, validation, not found)
//   2  usage error (bad arguments; nothing was sent)
//   3  HELD_FOR_REVIEW — recorded as a proposal for a human; NOT applied
//   4  denied by role or approval policy
//   5  conflict (claim held elsewhere, state conflict)
//
// Output is JSON on stdout: pretty when stdout is a TTY, compact when piped.
// --json forces compact JSON either way. Diagnostics go to stderr.

import { parseArgs } from "node:util";

import { createClient, ApiError } from "./api.mjs";
import { COMMANDS, UsageError } from "./commands.mjs";

const GLOBAL_FLAGS = {
  json: { type: "boolean", desc: "Force compact JSON output" },
  "dry-run": { type: "boolean", desc: "Ask what the call would do; write nothing" },
  board: { type: "string", desc: "Board id (default: KANBAN_BOARD_ID, else the workspace's first board)" },
  url: { type: "string", desc: "App base URL (default: KANBAN_URL, else http://localhost:3000)" },
  key: { type: "string", desc: "Agent key kbn_… — acts as a bot (default: KANBAN_AGENT_KEY)" },
  "user-key": { type: "string", desc: "Personal key kbu_… — acts as YOU (default: KANBAN_USER_KEY)" },
  "idempotency-key": { type: "string", desc: "Stable key so a retried create is not a duplicate" },
  help: { type: "boolean", short: "h", desc: "Show help" },
};

function fail(message, exitCode = 1) {
  console.error(`kanban: ${message}`);
  process.exit(exitCode);
}

function print(data, forceJson) {
  const compact = forceJson || !process.stdout.isTTY;
  process.stdout.write(JSON.stringify(data, null, compact ? 0 : 2) + "\n");
}

// ── Help ────────────────────────────────────────────────────────────────────

function flagLines(flags) {
  return Object.entries(flags).map(
    ([name, meta]) =>
      `  --${name}${meta.type === "string" ? " <v>" : ""}${meta.multiple ? " (repeatable)" : ""}${meta.required ? " (required)" : ""}  ${meta.desc ?? ""}`
  );
}

function commandUsage(cmd) {
  const pos = (cmd.positionals ?? [])
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  return `kanban ${cmd.noun}${cmd.verb ? ` ${cmd.verb}` : ""}${pos ? ` ${pos}` : ""}`;
}

function helpForCommand(cmd) {
  const lines = [commandUsage(cmd), "", `  ${cmd.desc}`];
  if (cmd.flags && Object.keys(cmd.flags).length) {
    lines.push("", "Flags:", ...flagLines(cmd.flags));
  }
  if (cmd.mutating) {
    lines.push("", "  Mutating: supports --dry-run. Exit 3 means HELD_FOR_REVIEW (a proposal, not applied).");
  }
  lines.push("", "Global flags:", ...flagLines(GLOBAL_FLAGS));
  return lines.join("\n");
}

function helpGeneral() {
  const byNoun = new Map();
  for (const cmd of COMMANDS) {
    if (!byNoun.has(cmd.noun)) byNoun.set(cmd.noun, []);
    byNoun.get(cmd.noun).push(cmd);
  }
  const lines = [
    "kanban — CLI for the Kanban board (agent-key auth).",
    "",
    "Usage: kanban <noun> [verb] [args] [flags]",
    "",
    "Environment: KANBAN_URL, KANBAN_AGENT_KEY, KANBAN_BOARD_ID",
    "",
    "Exit codes: 0 ok · 1 error · 2 usage · 3 held for review · 4 denied · 5 conflict",
    "",
    "Commands:",
  ];
  for (const [noun, cmds] of byNoun) {
    for (const cmd of cmds) {
      lines.push(`  ${commandUsage(cmd).slice("kanban ".length).padEnd(34)} ${cmd.desc.split(". ")[0]}`);
    }
    void noun;
  }
  lines.push("", "Run `kanban <noun> <verb> --help` for a command's flags.", "", "Global flags:", ...flagLines(GLOBAL_FLAGS));
  return lines.join("\n");
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  console.log(helpGeneral());
  process.exit(0);
}

const noun = argv[0];
const nounCommands = COMMANDS.filter((c) => c.noun === noun);
if (nounCommands.length === 0) fail(`unknown command "${noun}" — run \`kanban --help\``, 2);

// A noun with a null verb (me, knowledge) takes no verb token; otherwise the
// second token picks the row.
let cmd;
let rest;
if (nounCommands.length === 1 && nounCommands[0].verb === null) {
  cmd = nounCommands[0];
  rest = argv.slice(1);
} else {
  const verb = argv[1];
  if (!verb || verb.startsWith("-")) {
    if (verb === "--help" || verb === "-h" || verb === undefined) {
      const verbs = nounCommands.map((c) => c.verb).join(", ");
      console.log(`kanban ${noun} — verbs: ${verbs}\nRun \`kanban ${noun} <verb> --help\` for details.`);
      process.exit(0);
    }
    fail(`"kanban ${noun}" needs a verb (${nounCommands.map((c) => c.verb).join(", ")})`, 2);
  }
  cmd = nounCommands.find((c) => c.verb === verb);
  if (!cmd) fail(`unknown command "${noun} ${verb}" — verbs: ${nounCommands.map((c) => c.verb).join(", ")}`, 2);
  rest = argv.slice(2);
}

let parsed;
try {
  parsed = parseArgs({
    args: rest,
    options: Object.fromEntries(
      Object.entries({ ...(cmd.flags ?? {}), ...GLOBAL_FLAGS }).map(([name, meta]) => [
        name,
        {
          type: meta.type,
          ...(meta.multiple ? { multiple: true } : {}),
          ...(meta.short ? { short: meta.short } : {}),
        },
      ])
    ),
    allowPositionals: true,
  });
} catch (error) {
  fail(`${error.message} — run \`kanban ${noun}${cmd.verb ? ` ${cmd.verb}` : ""} --help\``, 2);
}

const { values: opts, positionals: rawPos } = parsed;

if (opts.help) {
  console.log(helpForCommand(cmd));
  process.exit(0);
}

// Validate and coerce positionals.
const wanted = cmd.positionals ?? [];
if (rawPos.length > wanted.length) {
  fail(`unexpected argument "${rawPos[wanted.length]}" — usage: ${commandUsage(cmd)}`, 2);
}
const pos = [];
for (let i = 0; i < wanted.length; i += 1) {
  const spec = wanted[i];
  const value = rawPos[i];
  if (value === undefined) {
    if (spec.required) fail(`missing <${spec.name}> — usage: ${commandUsage(cmd)}`, 2);
    pos.push(undefined);
    continue;
  }
  if (spec.int) {
    const n = Number(value);
    if (!Number.isInteger(n)) fail(`<${spec.name}> must be an integer, got "${value}"`, 2);
    pos.push(n);
  } else {
    pos.push(value);
  }
}

// Required flags.
for (const [name, meta] of Object.entries(cmd.flags ?? {})) {
  if (meta.required && opts[name] === undefined) {
    fail(`--${name} is required — usage: ${commandUsage(cmd)}`, 2);
  }
}

if (opts["dry-run"] && !cmd.mutating) {
  fail(`--dry-run is not supported by "${noun}${cmd.verb ? ` ${cmd.verb}` : ""}" (reads, claims, releases, and bulk have no dry run)`, 2);
}

// ── Context and execution ───────────────────────────────────────────────────

const baseUrl = opts.url ?? process.env.KANBAN_URL ?? "http://localhost:3000";

// Two credential classes: a personal key acts as YOU, an agent key as a bot.
// An explicit flag beats the environment; between the two, the personal key
// wins — when both are configured, attributing work to the person is the
// safer default, and the stderr note says which identity is speaking.
const flagUserKey = opts["user-key"];
const flagAgentKey = opts.key;
if (flagUserKey && flagAgentKey) {
  fail("pass --key or --user-key, not both", 2);
}
let key;
let keyHeader;
if (flagUserKey) {
  [key, keyHeader] = [flagUserKey, "x-user-key"];
} else if (flagAgentKey) {
  [key, keyHeader] = [flagAgentKey, "x-agent-key"];
} else if (process.env.KANBAN_USER_KEY) {
  [key, keyHeader] = [process.env.KANBAN_USER_KEY, "x-user-key"];
  if (process.env.KANBAN_AGENT_KEY) {
    console.error("kanban: both KANBAN_USER_KEY and KANBAN_AGENT_KEY are set — acting as YOU (user key)");
  }
} else if (process.env.KANBAN_AGENT_KEY) {
  [key, keyHeader] = [process.env.KANBAN_AGENT_KEY, "x-agent-key"];
}
if (!key) {
  fail(
    "no credential. Set KANBAN_USER_KEY (personal key from Settings → API keys, acts as you)\n" +
      "or KANBAN_AGENT_KEY (bot key, mint with:\n" +
      '  npm run create-agent -- --workspace <slug> --name "My Bot" --role member)',
    2
  );
}

const client = createClient({
  baseUrl,
  key,
  keyHeader,
  timeoutMs: Number(process.env.KANBAN_TIMEOUT_MS ?? 15000),
  dryRun: Boolean(opts["dry-run"]),
});

const pinnedBoard = opts.board ?? process.env.KANBAN_BOARD_ID;

const ctx = {
  api: client.api,
  create: client.create,
  me: client.me,
  async boardId() {
    if (pinnedBoard !== undefined) {
      const n = Number(pinnedBoard);
      if (!Number.isInteger(n)) fail(`--board must be an integer, got "${pinnedBoard}"`, 2);
      return n;
    }
    const info = await client.me();
    if (!info.boards?.length) throw new ApiError("NOT_FOUND", 404, "This agent's workspace has no boards.", false);
    if (info.boards.length > 1) {
      console.error(
        `kanban: ${info.boards.length} boards in this workspace; defaulting to ` +
          `#${info.boards[0].id} "${info.boards[0].name}". Pass --board or set KANBAN_BOARD_ID to pin one.`
      );
    }
    return info.boards[0].id;
  },
  // An agent's me carries a scalar workspaceId; a human's carries workspaces
  // and per-board workspaceIds. Resolve in that order: agent scalar, the
  // pinned/default board's workspace, then a sole membership.
  async workspaceId() {
    const info = await client.me();
    if (info.workspaceId) return info.workspaceId;
    const boards = info.boards ?? [];
    const boardId = await this.boardId();
    const viaBoard = boards.find((b) => b.id === boardId)?.workspaceId;
    if (viaBoard) return viaBoard;
    if (info.workspaces?.length === 1) return info.workspaces[0].id;
    throw new ApiError(
      "INVALID_REQUEST",
      0,
      "Cannot resolve a workspace — pass --board for a board in the workspace you mean.",
      false
    );
  },
};

// process.exitCode rather than process.exit(): on Windows, exiting while a
// piped stdout still has a pending write trips a libuv assertion
// (src\win\async.c). Setting exitCode lets the loop drain and exit clean.
try {
  const { status, data } = await cmd.run(ctx, pos, opts);
  print(data, opts.json);
  // 202 is the one success status that is not success: the mutation was
  // recorded as a proposal for a human, not applied. Scripts must be able to
  // tell without parsing the body.
  if (status === 202 || data?.code === "HELD_FOR_REVIEW") {
    console.error("kanban: held for review — recorded as a proposal, NOT applied");
    process.exitCode = 3;
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`kanban: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof ApiError) {
    console.error(`kanban: ${error.code} — ${error.message}`);
    process.exitCode = error.status === 403 ? 4 : error.status === 409 ? 5 : 1;
  } else {
    console.error(`kanban: ${error.message ?? error}`);
    process.exitCode = 1;
  }
}
