# kanban CLI — Door 4

A noun-verb command line over the same REST API the web UI (Door 1), MCP
server (Door 2), and raw HTTP (Door 3) use. It authenticates as a
workspace-scoped agent via `x-agent-key`, so it is subject to the same RBAC,
approval policy, and audit trail — not a privileged back door.

```sh
KANBAN_URL=http://localhost:3000 KANBAN_AGENT_KEY=kbn_… npm run cli -- me

# or, after npm link / global install:
kanban me
kanban task claim 42 --ttl 60
kanban task comment 42 "root cause found"
kanban task move 42 --column 3
kanban task release 42
```

Mint a key with `npm run create-agent`. `KANBAN_BOARD_ID` (or `--board`) pins
the default board in a multi-board workspace.

## Acting as yourself — the personal key

An agent key (`kbn_…`) attributes everything to a bot. To act as *you* — same
boards, same role, history that says your name — mint a personal key in
**Settings → API keys** and use it instead:

```sh
KANBAN_USER_KEY=kbu_… kanban me
kanban --user-key kbu_… task comment 42 "reviewed, shipping"
```

The personal key travels in `x-user-key` and resolves to your user account;
your workspace roles are looked up per request, exactly as for a browser
session. When both env keys are set the personal key wins (a stderr note says
so); passing both flags is an error. Personal keys also unlock the commands an
agent key cannot reach: `notify list`, `notify seen`, and `knowledge`.

Key hygiene: keys are shown once at mint, stored hashed, revocable in the same
settings panel, and minting requires a browser session — a leaked key cannot
mint further keys.

## Exit codes — the contract with scripts

| Code | Meaning |
|---|---|
| 0 | Applied / read OK |
| 1 | Error: network, server, auth, validation, not found |
| 2 | Usage error — nothing was sent |
| 3 | `HELD_FOR_REVIEW` — recorded as a proposal for a human; **not** applied |
| 4 | Denied by role or approval policy |
| 5 | Conflict — claim held elsewhere, or state conflict |

A script that treats any non-zero as "failed" is wrong about 3: the request
succeeded *as a proposal*. Branch on it.

## Conventions

- Output is JSON on stdout: pretty on a TTY, compact when piped; `--json`
  forces compact. Diagnostics go to stderr.
- Mutating commands accept `--dry-run`: the server reports the approval tier
  the call would run under and the before/after state, and writes nothing.
  Claims, releases, and bulk have no dry run.
- Creates send an `Idempotency-Key` automatically; pass `--idempotency-key`
  to make retries of the same logical request explicit.
- Nullable fields accept the literal `null`: `kanban task due 42 null`.
- `kanban --help` lists every command; `kanban <noun> <verb> --help` shows a
  command's flags.

## Files

- `kanban.mjs` — entry: parsing, dispatch, output, exit codes.
- `commands.mjs` — the command table; one row per command, each one or two
  REST calls. Add a command by adding a row.
- `api.mjs` — HTTP core (deadline, bounded retry with jitter, error
  classification), a port of the one in `mcp/server.mjs`; kept as a separate
  copy so the doors version independently. It returns `{ status, data }`
  because the CLI must map 202 to exit 3.

Not reachable with an *agent* key (server-side, shared with the other doors):
`notify list`, `notify seen`, and `knowledge` accept only human credentials —
a session or a personal key.
