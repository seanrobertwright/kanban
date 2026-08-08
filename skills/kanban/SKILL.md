---
name: kanban
description: Work a self-hosted Kanban board from any repo — read the board, create/update/move/claim tasks, comment, and honor the approval gate. Use when the user mentions their kanban board, board tasks/tickets, sprints, or asks to file, update, pick up, or finish board work.
---

# Working the Kanban board

You are talking to a self-hosted Kanban app whose API treats an agent as a
first-class principal: you act under your own identity, your actions land in
each task's history under your name, and some of what you propose is held for
a human to approve. This skill tells you how to connect, how to behave, and
what will surprise you.

## 1. Pick your door

Check in this order:

1. **MCP tools present?** If tools named `mcp__kanban__*` (e.g.
   `mcp__kanban__whoami`, `mcp__kanban__list_board`) are available, use them —
   they map one-to-one onto the HTTP API and handle auth for you. Skip to §2.
2. **Environment configured?** If `KANBAN_URL` and `KANBAN_AGENT_KEY` are set
   (check with `echo ${KANBAN_URL:+set} ${KANBAN_AGENT_KEY:+set}` — never echo
   the key itself), speak HTTP directly:

   ```sh
   curl -s "$KANBAN_URL/api/agent/me" -H "x-agent-key: $KANBAN_AGENT_KEY"
   ```

   Every endpoint takes the `x-agent-key` header. A `.env`/`.env.local` in the
   repo may hold these under the same names; load, do not print.
3. **Neither?** Stop and tell the user what you need — do not guess:
   - A workspace admin mints an agent key in the app: **Settings → Agents →
     Add an agent** (kind: external). The `kbn_…` token is shown exactly once.
   - Set `KANBAN_URL` (the app's origin, e.g. `http://localhost:6810`) and
     `KANBAN_AGENT_KEY` (the token) in the environment or repo `.env`.
   - Optional MCP wiring (needs the kanban repo checked out somewhere): add to
     this repo's `.mcp.json`:

     ```json
     {
       "mcpServers": {
         "kanban": {
           "command": "node",
           "args": ["<path-to-kanban-repo>/mcp/server.mjs"],
           "env": { "KANBAN_URL": "http://localhost:6810", "KANBAN_AGENT_KEY": "kbn_…" }
         }
       }
     }
     ```

     `.mcp.json` must be gitignored — it holds a live credential.

**The key is a credential.** Never print it, commit it, or paste it into
comments, code, or task descriptions.

## 2. Orient before acting

- Call `whoami` (`GET /api/agent/me`) first: your identity, workspace, and
  every board you can reach, with ids.
- Use `search_tasks` with filters instead of reading a whole board — boards
  are big and `list_board` is the expensive read. `list_columns` is the cheap
  way to get column ids.
- Column ids, not names, drive moves. Read them before `move_task`.

## 3. The work loop

For "pick up a task and do it":

1. `whoami` → board id.
2. `search_tasks` (or the task id the user gave) → the task.
3. `claim_task` — an exclusive **lease**, not a flag: it expires on its own
   (default a few hours; pass `ttlMinutes` for longer work). Claim before you
   start so a second agent doesn't double-work it.
4. Do the actual work in the repo.
5. `comment_on_task` with what you did — link commits/PRs by URL.
6. `move_task` to the done/review column (ids from `list_columns`), or
   `release_task` if you stopped without finishing.

For "file what we just discussed": `create_task` with a clear title, the
detail in `description`, and set fields with the **narrow tools**
(`set_priority`, `set_due_date`, `set_labels`, `assign_task`, `set_estimate`)
rather than one big `update_task` — a narrow call records a narrow intent in
the history, where a patch makes a reader diff it.

## 4. The approval gate — expect 202s

Some calls do not apply immediately. Consequential actions (creating
top-level tasks, moves, assignment changes — whatever the workspace's policy
raises) come back **202 held for review**: your proposal enters a changeset a
human accepts or rejects. This is normal, not an error.

- After a hold, say so in your report to the user: "proposed, awaiting
  review", never "done".
- Do not retry a held call — that files a second proposal.
- You cannot review your own changeset; the server refuses agents there by
  design.
- **Dry-run first when unsure:** send header `Dry-Run: true` on any mutating
  request (MCP tools take a `dryRun` parameter) and the server answers what
  would happen — which tier it hits, what would change — without doing it or
  spending a proposal.

## 5. Sharp edges

- `set_custom_fields` **replaces the whole set** — read `list_custom_fields`
  + the task's current values first and send back everything you want kept.
- Deletion is not offered to agents, anywhere. Don't look for it.
- `get_time_entries` is read-only; agents do not log time (agent spend is
  metered in dollars, not hours).
- Polling: use `wait_for_changes` (blocks until the board changes) instead of
  re-reading a board on a timer.
- Errors: `401` = bad/revoked key (ask the user to re-mint); `403` with a
  role message = your role is too low for that verb; `409` on claim = someone
  else holds the lease — read `task_history` to see who.
- Everything you do is attributed and audited. Write comments you would be
  happy to have read back in a standup.

## Reference

Full tool list and endpoint reference live in the kanban repo:
`mcp/README.md` (49 MCP tools) and `docs/agent-api.md` (HTTP). The hosted
docs mirror them under **Agents** at the project's docs site.
