# Kanban App — Comprehensive User Acceptance Test (UAT) Plan

**Application:** Kanban (self-hosted task management, `scrap/kanban` repository)
**Document version:** 1.1
**Date prepared:** 2026-07-25 · **Revised:** 2026-08-06

> **What changed in 1.1.** The 2026-08-06 run (`devdocs/uat-run-2026-08-06.md`)
> found that the plan described a UI the app had moved on from, in ways that
> would make a diligent tester file failures against working software. Corrected
> here: the sign-in copy and the SSO button (Suite 1), the sidebar and toolbar
> descriptions (§3), and the route to every panel — the eighteen-button toolbar
> was cut down, so `Toolbar → Sprints` and its siblings now name where those
> panels actually live. §1.4 gains the two environment rules that run learned the
> hard way: serve the app on the origin sign-in is configured for, and warm it up
> first. Expectations about *behaviour* are unchanged; only the routes and the
> chrome descriptions were stale.
**Intended tester:** Someone with ZERO prior experience with this application. Every step tells you exactly what to click and exactly what you should see.

---

## 1. Introduction

### 1.1 Purpose

This document walks a tester through every major feature of the Kanban application, in dependency order (later suites rely on data created in earlier ones). Execute the suites **in order, top to bottom**, in a single test session if possible.

### 1.2 How to record results

Each test case ends with a result line:

> **Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

- **Pass** — every Expected Result in the case was observed exactly.
- **Fail** — at least one Expected Result did not happen. In Notes, record: the step number that failed, what you saw instead, and any red error text on screen. Screenshots are strongly encouraged.
- **Blocked** — you could not attempt the case (a precondition failed, an earlier dependency case failed, or the case requires external setup you do not have). Note why.

Do not stop on a Fail unless the app is unusable — mark it and continue.

### 1.3 Tester prerequisites

| Item | Requirement |
|---|---|
| Browser | A current desktop Chrome, Edge, or Firefox, window at least 1280 px wide (the left sidebar is hidden on narrow windows — the same tool buttons then appear across the top of the page instead). |
| Test account A ("Owner") | A GitHub account you can sign in with: `__________________`. There is no email/password form: the app signs in through **GitHub OAuth** or an **enterprise IdP** (the **Sign in with SSO** button, which needs the setup in UAT-098 — without it, use GitHub). |
| Test account B ("Second user") | A second, different GitHub account, ideally in a second browser or a private/incognito window: `__________________`. Needed for the members/roles, viewer-negative, and notification tests. |
| Keyboard note | "Ctrl+K" below means Cmd+K on macOS. |

### 1.4 Environment setup and verification

Perform (or have a developer perform) the following before testing. Skip to step 6 if a running instance and URL were handed to you.

1. In a terminal at the repository root, run: `docker compose up -d` — starts Postgres (host port 5434) and MinIO (attachment storage).
2. Ensure `.env.local` exists with `DATABASE_URL`, GitHub OAuth client id/secret, and auth secret configured (developer task).
3. Run `npm run db:setup` (runs the auth migration then the app migrations). **Expected:** finishes without error.
4. Run `npm run dev` (set `PORT` to match `BETTER_AUTH_URL` — see the port rule below). **Expected:** "ready" output naming that URL.
5. Optional (needed only for UAT-095 real-time co-editing): run `npm run realtime` in a second terminal.
6. **Verify:** open the app in the browser (see the port rule below). **Expected:** you are redirected to `/sign-in` and see the card described in UAT-001.

**The port is not incidental — sign-in fails on the wrong one.** `BETTER_AUTH_URL`
is both the origin better-auth trusts and the callback GitHub redirects to, and
that callback is registered in the GitHub OAuth app. Serve the app anywhere else
and **Continue with GitHub** answers `403` with `Invalid origin` — visible only in
the server log, not on screen. Check which origin is configured before you start:

- compose stack: `docker compose ps` — the `app` host port (this repo defaults to
  `APP_PORT=6810`, and the container sets `BETTER_AUTH_URL` to match);
- local `npm run dev`: `BETTER_AUTH_URL` in `.env.local`, and set `PORT` to the
  same port.

**Warm the app before testing.** Next compiles each route on first request, and
in the compose stack (a bind-mounted `next dev`) that is 3–24 seconds *per route*
— slow enough that a save looks like it silently failed when it is merely in
flight. Either click through the app once to warm it, or curl the API routes
before you start. For a full UI run, local `npm run dev` is markedly faster than
the compose stack.

Record the build under test (git commit hash) in the sign-off table at the end: run `git rev-parse --short HEAD` in the repo, or ask the developer.

### 1.5 Features that need external services

Some cases exercise integrations that need real third-party setup (GitHub App, Slack, Microsoft Teams, SAML/OIDC identity provider, SCIM client, an external webhook receiver, an LLM API key for agent runs). Each such case carries a **"Requires external setup"** precondition. If the setup is absent, mark the case **Blocked** — that is an expected outcome, not a failure.

---

## 2. Test data conventions

So all test data is recognisable and easy to clean up afterwards, prefix **everything you create** with `UAT-`:

| Object | Naming pattern | Examples |
|---|---|---|
| Workspaces | `UAT-WS-nn` | `UAT-WS-01` |
| Boards | `UAT-Board-nn` | `UAT-Board-01` |
| Columns | `UAT-Col-<name>` | `UAT-Col-Todo`, `UAT-Col-Doing`, `UAT-Col-Done` |
| Tasks | `UAT-Task-nn` | `UAT-Task-01` |
| Labels | `uat-<name>` | `uat-bug`, `uat-frontend` |
| Sprints / milestones / releases / epics / objectives | `UAT-Sprint-nn`, `UAT-MS-nn`, `UAT-Rel-nn`, `UAT-Epic-nn`, `UAT-Obj-nn` | |
| Templates, forms, automations, views, docs, channels, whiteboards, reports, agents | `UAT-<type>-nn` | `UAT-Form-01`, `UAT-Rule-01` |

Unless a case says otherwise, **all work happens on board `UAT-Board-01` inside workspace `UAT-WS-01`**, created in Suite 2. After the whole run, delete `UAT-` prefixed data (or drop the test database).

---

## 3. Test suites

Conventions used in the steps below:

- **Bold text** is an exact UI label — a button, menu item, field label, or placeholder.
- "Sidebar" = the left column: the **KANBAN** logo, the **Search / command** pill (with a **⌘K** hint), a **WORKSPACE** heading with the board switcher, then grouped tool headings — **COLLABORATE** (**Ask**, **Docs**, **Chat**, **Whiteboards**), **PLAN** (**Programs**, **Scaled Agile**, **Portfolio**, **Reports**) and **ADMINISTER** (**Settings**) — and at the bottom your avatar, name, role and a theme toggle.
- "Toolbar" = the row above the board: the **Search tasks** box, the **Priority** and **Assignee** filters, **Views**, **Save**, four view tabs (**Board · List · Timeline · Dashboard**), a **More views** dropdown (**Calendar**, **Gantt**, **Backlog**, **Roadmap**, **Requests**), a primary **NEW TASK** button, and a **⋯** overflow menu.

**Where the panels live.** The toolbar used to carry eighteen buttons; they were
consolidated, so a case that needs one of them says where it is now. Three routes
reach everything, and the fastest is always the palette:

| Route | What is behind it |
|---|---|
| **⌘K palette** | Every panel below, by name — type the panel's name and press Enter. The universal route; use it if a menu path ever disagrees with this table. |
| **Settings…** (⋯ menu, or sidebar **Settings**) | *Board*: **Labels**, **Custom fields**, **Templates**, **Automations**, **Forms**. *Planning*: **Sprints**, **Milestones**, **Releases**, **Epics**, **Objectives**. *Workspace*: **Overview**, **Members**, **Agents**, **Webhooks**, **Permissions**, **Repositories**, **Email intake**, **Audit log**, **Security & compliance**. |
| **⋯** overflow | **Settings…**, **Schedule**, *Measure* (**Insights**, **Timesheet**, **Capacity**, **Budget**), *Intake* (**Requests**, **Discovery**), **Share…**, **Export CSV**, **Export JSON**, *Density*. |
- "Task dialog" = the panel that slides in from the right edge when you create or open a task.

---

## Suite 1 — Sign-in and application shell

### UAT-001 — Unauthenticated visit redirects to sign-in
**Preconditions:** Environment running (§1.4). Browser has no session (fresh/incognito window).
1. Navigate to the app's configured origin (§1.4).
   - **Expected:** the URL changes to `/sign-in`. A centred card shows the title **Sign in**, the sentence "Use your GitHub account or your company's identity provider.", a primary button **Continue with GitHub**, and beneath it a secondary button **Sign in with SSO**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-002 — Sign in with GitHub (account A)
**Preconditions:** UAT-001 passed. GitHub test account A credentials at hand.
1. Click **Continue with GitHub**.
   - **Expected:** button text changes to **Redirecting…** and the browser goes to github.com.
2. Complete the GitHub login/authorize screen with account A.
   - **Expected:** you land back on the app origin showing the app shell (next case describes it). No error page.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-003 — Application shell layout
**Preconditions:** Signed in as account A.
1. Look at the left sidebar, top to bottom.
   - **Expected:** a "K" logo tile and the word **KANBAN**; a pill reading **Search / command** with a **⌘K** key hint; a **WORKSPACE** heading with a board-switcher button; then three grouped headings — **COLLABORATE** (**Ask**, **Docs**, **Chat**, **Whiteboards**), **PLAN** (**Programs**, **Scaled Agile**, **Portfolio**, **Reports**) and **ADMINISTER** (**Settings**); at the bottom your GitHub avatar, your name, your role (e.g. `OWNER`), and a theme toggle button.
   - **Expected:** **Settings** is present under ADMINISTER — it is the admin surface, and its *Workspace* group carries the console sections (Overview, Members, Agents, Webhooks, Permissions, Audit log, Security & compliance) because you own this workspace.
2. Look at the top header of the main area.
   - **Expected:** breadcrumb "workspace-name / BOARD-NAME" (a personal workspace and default board were auto-created on first sign-in); the hint "Drag tasks between columns to update their status."; a stack of member avatars; a bell (notifications) button.
3. Look at the main area.
   - **Expected:** the toolbar described in §3 conventions, and a board of columns (a fresh personal board seeds default columns).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-004 — Theme toggle
1. Click the theme toggle button at the bottom of the sidebar (sun/moon icon).
   - **Expected:** the whole UI switches between light and dark. Click again — it switches back.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 2 — Workspace and board setup

### UAT-005 — Create workspace UAT-WS-01
**Preconditions:** Signed in as account A.
1. In the sidebar under **WORKSPACE**, click the board-switcher button (shows the current board's name).
   - **Expected:** a dropdown opens, grouped one block per workspace — each headed by the workspace name and your role in it, then its boards (the current one ticked), then **New board**, **Rename workspace**, **Delete workspace**, and the workspace-scoped entries **Members**, **Agents**, **Webhooks**, **Repositories**. At the very bottom: **New workspace**.
2. Click **New workspace**.
   - **Expected:** a dialog titled **New workspace** opens with a name field (placeholder **Acme Inc**).
3. Type `UAT-WS-01` and submit (**Create** button / Enter).
   - **Expected:** dialog closes; the app now shows workspace `UAT-WS-01` with a default board; the header breadcrumb starts with `UAT-WS-01`.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-006 — Create board UAT-Board-01
1. Open the board switcher again; click **New board** (under workspace `UAT-WS-01`).
   - **Expected:** a dialog titled **New board** with a name field (placeholder **Roadmap**).
2. Type `UAT-Board-01` and submit.
   - **Expected:** the app switches to the new board; header shows `UAT-WS-01 / UAT-BOARD-01` (board name renders uppercase).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-007 — Switch between boards
1. Open the board switcher; click the previous board's name, then repeat and click `UAT-Board-01`.
   - **Expected:** each click loads that board; the header breadcrumb and column set change accordingly; no stale tasks from the previous board remain visible.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-008 — NEGATIVE: cannot open a board in someone else's workspace
**Preconditions:** Account B signed in (other browser/incognito) at least once. Know the numeric id of one of account A's boards: while on `UAT-Board-01` as account A, note the `?board=NN` number in the URL (switch boards once if the URL has no `?board=`).
1. As **account B**, navigate to `<app-origin>/?board=NN` (account A's board id).
   - **Expected:** a "not found" (404) page — NOT account A's board. No column or task titles from account A's board are visible.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 3 — Columns

All on `UAT-Board-01` as account A. If the new board seeded default columns, keep them; these cases add their own.

### UAT-009 — Add columns
1. Scroll the board horizontally to its right end; click **Add column**.
   - **Expected:** an input appears (placeholder **Column name**) with buttons **Add** and **Cancel**.
2. Type `UAT-Col-Todo`; click **Add**.
   - **Expected:** a new empty column titled UAT-COL-TODO appears at the right end, showing a task count of `0`.
3. Repeat to add `UAT-Col-Doing` and `UAT-Col-Done`.
   - **Expected:** three UAT columns now exist, in the order added.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-010 — Rename a column
1. In the `UAT-Col-Todo` column header, click the **⋯** button (tooltip **Column options for UAT-Col-Todo**).
   - **Expected:** a menu opens with **Rename**, **Set WIP limit**, **Move left**, **Move right**, **Set as done column**, **Delete column** (the last two only because you are owner/admin).
2. Click **Rename**; the title becomes an editable input. Change it to `UAT-Col-Backlog`; press Enter.
   - **Expected:** the column header now reads UAT-COL-BACKLOG.
3. Rename it back to `UAT-Col-Todo` the same way.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-011 — Reorder columns
1. Open `UAT-Col-Done`'s **⋯** menu; click **Move left**.
   - **Expected:** the column swaps one position left immediately.
2. Click **⋯ → Move right** to put it back.
   - **Expected:** original order restored. On the leftmost column, **Move left** is greyed out; on the rightmost, **Move right** is greyed out.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-012 — Set the done column
1. Open `UAT-Col-Done`'s **⋯** menu; click **Set as done column**.
   - **Expected:** a green check icon appears beside the column title (hover text: "Done column — a recurring task moved here spawns the next one"). The menu item now reads **Unset done column**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-013 — Set a WIP limit
1. Open `UAT-Col-Doing`'s **⋯** menu; click **Set WIP limit**.
   - **Expected:** the header count swaps to a number input (placeholder **No limit**).
2. Type `2`; press Enter.
   - **Expected:** the column count now displays `0/2`.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-014 — NEGATIVE: deleting a non-empty column is refused
**Preconditions:** Run after Suite 4 has created tasks (return here), or create one quick task in `UAT-Col-Todo` first (see UAT-016 step 1–3).
1. Open the **⋯** menu of a column that contains at least one task; click **Delete column**.
   - **Expected:** the column does NOT disappear. A red error message appears above the board saying the column still holds tasks (it states how many). The tasks remain.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-015 — Delete an empty column
1. Add a throwaway column `UAT-Col-Temp` (as UAT-009).
2. Open its **⋯** menu; click **Delete column**.
   - **Expected:** the empty column disappears immediately, with no error.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 4 — Tasks: create, edit, move, delete

### UAT-016 — Create a task
1. At the bottom of `UAT-Col-Todo`, click **Add task**.
   - **Expected:** the task dialog slides in from the right, titled **New task**, with subtitle "Add a task to this column." Fields visible: **Title** (placeholder **What needs doing?**), **Description** (placeholder **Optional details — Markdown supported**, with **Write**/**Preview** toggle), **Assignee** (value **Unassigned**), **Priority** (value **No priority**), **Start date**, **Due date**, **Type** (value **Task**), **Estimate** (placeholder **Points**), **Value**, **Risk**, **Score** (shows **—**), **Repeat** (value **Does not repeat**), **Labels**. Footer buttons: **Cancel** and **Create task**.
2. Type Title `UAT-Task-01`; click **Create task**.
   - **Expected:** dialog closes; a card **UAT-Task-01** appears in `UAT-Col-Todo`; the column count increments.
3. Repeat to create `UAT-Task-02` and `UAT-Task-03` in `UAT-Col-Todo`.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-017 — Edit a task
1. Click the card `UAT-Task-01` (or its **⋯** menu, tooltip **Task actions**, then **Edit**).
   - **Expected:** the task dialog opens titled **Edit task** with the current values filled in, plus (because the task now exists) the sections **Subtasks**, **Checklist**, **Blocked by**, attachments (**Add file**), time, **Fields** (only if custom fields exist), **Development**, **Connected work**, comments, and **History**. Footer button reads **Save changes**.
2. Change Title to `UAT-Task-01 edited`; in **Description** type `**bold** and `` `code` ``; click the **Preview** toggle.
   - **Expected:** the preview renders "bold" in bold and "code" in monospace — not raw asterisks/backticks, and no raw HTML.
3. Click **Save changes**.
   - **Expected:** dialog closes; the card title updates on the board.
4. Reopen the task; rename back to `UAT-Task-01`; **Save changes**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-018 — Drag a task between columns
1. Press and hold on card `UAT-Task-01`, drag it over `UAT-Col-Doing`, release.
   - **Expected:** the card now sits in `UAT-Col-Doing`; both column counts update. Reload the page — the card is still in `UAT-Col-Doing` (the move persisted).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-019 — Reorder tasks within a column
1. In `UAT-Col-Todo`, drag `UAT-Task-03` above `UAT-Task-02`; release.
   - **Expected:** the order changes and persists after a page reload.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-020 — NEGATIVE: WIP limit warns but does not block
**Preconditions:** UAT-013 set `UAT-Col-Doing`'s limit to 2.
1. Drag `UAT-Task-02` and `UAT-Task-03` into `UAT-Col-Doing` so it holds 3 tasks.
   - **Expected:** all three moves SUCCEED — the limit does not prevent the drop. The column count now reads **3/2** in a red/destructive badge (hover text: "Over the WIP limit: 3 of 2"). No blocking dialog appears.
2. Drag `UAT-Task-02` and `UAT-Task-03` back to `UAT-Col-Todo`.
   - **Expected:** count returns to `1/2` in normal styling.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-021 — Delete a task
1. Create a throwaway task `UAT-Task-Del` in `UAT-Col-Todo`.
2. On its card, open the **⋯** (**Task actions**) menu; click **Delete**.
   - **Expected:** the card disappears immediately and does not return after a reload.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-022 — Command palette (Ctrl+K)
1. Press **Ctrl+K** (Cmd+K on macOS), or click the sidebar **Search / command** pill.
   - **Expected:** a palette dialog opens with input placeholder **Search tasks or run a command…**, listing grouped commands: **Create** (**Create new task**), **Views** (**Go to Board**, **Go to List**, … **Go to Dashboard**), **Panels** (**Open Templates**, **Open Labels**, **Open Sprints**, **Open Milestones**, **Open Releases**, **Open Epics**, **Open Objectives**, **Open Custom fields**, **Open Insights**, **Open Schedule**, **Open Timesheet**, **Open Forms**, **Open Automations**, **Open Requests**, **Open Capacity**, **Open Budget**, **Open Discovery**).
2. Type `UAT-Task-01`.
   - **Expected:** the matching task appears in the results.
3. Press Enter on it.
   - **Expected:** the palette closes and the **Edit task** dialog opens for `UAT-Task-01`. Close it with **Cancel**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 5 — Task fields

All in the **Edit task** dialog for `UAT-Task-01` unless stated. Note: the **Milestone**, **Epic**, **Objective**, and **Sprint** selects only appear once the board has at least one of each — they are verified later, in their own suites.

### UAT-023 — Priority
1. Open `UAT-Task-01`; open the **Priority** select.
   - **Expected:** options in this order: **Urgent, High, Medium, Low, No priority** (highest first).
2. Choose **Urgent**; click **Save changes**.
   - **Expected:** the card on the board now shows an urgent-priority indicator chip.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-024 — Type and estimate
1. Open `UAT-Task-01`; set **Type** to **Bug** (options: **Task, Bug, Story**); set **Estimate** to `3`; **Save changes**.
2. Reopen the task.
   - **Expected:** Type shows **Bug**, Estimate shows `3`.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-025 — Start and due dates
1. Open `UAT-Task-01`; set **Start date** to today and **Due date** to 7 days from today; **Save changes**.
   - **Expected:** the card shows a due-date chip. Reopen the task — both dates persisted.
2. Clear the **Start date** (empty the date input); **Save changes**; reopen.
   - **Expected:** Start date is empty; Due date is unchanged.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-026 — Value / Risk / live Score preview
1. Open `UAT-Task-01` (Estimate = 3 from UAT-024). Type **Value** `8` and **Risk** `2`.
   - **Expected:** the **Score** readout updates live, WITHOUT saving, to `2.22` (formula: value ÷ (estimate × (1 + risk/10)) = 8 ÷ 3.6). Hovering the score shows the formula.
2. Clear **Value**.
   - **Expected:** Score shows **—**.
3. Set Value back to `8`; **Save changes**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-027 — Assignee
1. Open `UAT-Task-01`; open the **Assignee** select.
   - **Expected:** first option **Unassigned**; a **People** group listing workspace members (currently just account A).
2. Choose yourself; **Save changes**.
   - **Expected:** your avatar/initials appear on the card.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-028 — Recurring task spawns successor in done column
**Preconditions:** UAT-012 set `UAT-Col-Done` as done column.
1. Create task `UAT-Task-Recur` in `UAT-Col-Todo`; in the dialog set **Repeat** to **Daily** (options: **Does not repeat, Daily, Weekly, Monthly**); **Create task**.
2. Drag `UAT-Task-Recur` into `UAT-Col-Done`.
   - **Expected:** shortly after the drop, the board refreshes and a NEW occurrence of the task appears back at the start of the flow (the completed copy stays in `UAT-Col-Done` and is no longer recurring; the new one carries the recurrence).
3. Delete both copies (cleanup).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 6 — Subtasks, checklists, dependencies, attachments, comments, time

All inside the **Edit task** dialog for `UAT-Task-01` (open it, scroll below the Labels field).

### UAT-029 — Add and open a subtask
1. In the **Subtasks** section, type `UAT-Sub-01` in the input (placeholder **Add a subtask…**) and press Enter (or the add button).
   - **Expected:** `UAT-Sub-01` appears in the subtask list. The board card for `UAT-Task-01` gains a subtask **count** badge — `1`, titled "1 subtask". It is a count, not a done/total ratio; the checklist badge is the one shaped `1/2`.
2. Click the subtask `UAT-Sub-01` in the list.
   - **Expected:** the dialog swaps to **Edit subtask** for `UAT-Sub-01`, with a back link at the top showing the parent's title `UAT-Task-01`, and a **Status** select (listing the board's columns) that top-level tasks do not have. **Milestone/Epic/Objective/Sprint/Repeat** fields are absent for a subtask.
3. Change **Status** to `UAT-Col-Done`.
   - **Expected:** the change commits immediately (no save needed).
4. Click the back link (`UAT-Task-01`).
   - **Expected:** you return to the parent's dialog without it closing; the subtask now reads `Done` in the parent's list.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-030 — Checklist
1. In the **Checklist** section of `UAT-Task-01`, type `UAT check item 1` in the input (placeholder **Add an item**) and add it. Add a second item.
   - **Expected:** both items listed with checkboxes.
2. Tick the first item's checkbox.
   - **Expected:** it renders as done (struck through / checked). Close the dialog — the card shows a checklist progress badge (`1/2`).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-031 — Add a dependency (blocked by)
1. Open `UAT-Task-02`. In the **Blocked by** section, open the picker (**Add a blocking task…**) and choose `UAT-Task-01`; confirm with the **Add dependency** button.
   - **Expected:** `UAT-Task-01` is listed under **Blocked by**. On the board, `UAT-Task-02`'s card shows a blocked-by indicator.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-032 — NEGATIVE: circular dependency is refused
**Preconditions:** UAT-031 done (Task-02 is blocked by Task-01).
1. Open `UAT-Task-01`; in **Blocked by**, open the **Add a blocking task…** picker.
   - **Expected:** `UAT-Task-02` is NOT offered (the picker excludes tasks that would close a cycle).
2. If `UAT-Task-02` does appear, select it and click **Add dependency**.
   - **Expected:** the server refuses — an error message appears and no dependency is added. (Either behaviour — excluded from the picker, or refused on add — is a Pass; a successfully saved cycle is a Fail.)

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-033 — Attachments
1. Open `UAT-Task-01`; in the attachments section click **Add file** and choose a small file (e.g. a .png or .txt).
   - **Expected:** while uploading the control shows **Uploading…**; the file then appears in the list with its name; clicking it downloads/opens it. Closing the dialog, the card shows a paperclip count.
2. NEGATIVE: attempt to attach an empty (0-byte) file.
   - **Expected:** refused with the message "That file is empty."

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-034 — Log time
1. Open `UAT-Task-01`; in the time section enter `30` in the minutes input (placeholder **Min**) and `UAT testing` in the note input (placeholder **What for? (optional)**); confirm with the add/log button.
   - **Expected:** an entry (30 min, "UAT testing", your name, today) appears; a running total shows.
2. Scroll to **History** at the dialog's bottom.
   - **Expected:** the time entry is recorded in the activity feed.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-035 — Comments: post, reply, edit
1. Open `UAT-Task-01`; in the comment box (placeholder starts **Leave a comment — ...**) type `First **UAT** comment` and post it.
   - **Expected:** the comment renders with "UAT" in bold, your name, and a timestamp. The **History** feed below records the comment.
2. Use **Reply…** under the comment to post `A reply`.
   - **Expected:** the reply appears threaded under the first comment.
3. Use the comment's **Edit comment** control to change the text; save.
   - **Expected:** updated text shows.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-036 — Resolve and reopen a comment thread
**Preconditions:** UAT-035 done. You are member+ of the workspace (owner qualifies).
1. On the first comment, click **Resolve**.
   - **Expected:** the thread is marked resolved; the button now reads **Reopen**.
2. Click **Reopen**.
   - **Expected:** the thread returns to normal. (Viewers get no Resolve button at all — verified in UAT-092.)

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-037 — Task history feed
1. Open `UAT-Task-01` and read the **History** section.
   - **Expected:** entries exist for the changes made in this run — creation, moves between named columns, priority change, assignment, time logged, comments — each with an actor and timestamp.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 7 — Labels

### UAT-038 — Create labels
1. Open **Labels** (⌘K → "Labels", or **Settings…** → *Board* → **Labels**).
   - **Expected:** the **Labels** dialog opens (empty at first) with a **New label** input (placeholder **bug**) and a colour picker (**Label colour**).
2. Create `uat-bug` (pick red) and `uat-frontend` (another colour).
   - **Expected:** both appear with their colour dots.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-039 — Apply labels to a task
1. Open `UAT-Task-01`; under **Labels**, tick `uat-bug`; **Save changes**.
   - **Expected:** the card shows a coloured `uat-bug` chip.
2. Check the toolbar filter bar.
   - **Expected:** a **Label** facet button now exists (it only renders once labels exist).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-040 — Rename and delete a label (delete is admin-gated)
1. In the **Labels** dialog, rename `uat-frontend` to `uat-front`.
   - **Expected:** renamed everywhere.
2. Delete `uat-front` (delete control visible to you as owner/admin).
   - **Expected:** it disappears from the vocabulary and from any task wearing it. (Non-admin members do not see the delete control.)

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 8 — Views (each lens)

Prepare: ensure **both** `UAT-Task-01` and `UAT-Task-02` have start+due dates (UAT-025), the second pair falling after the first, and that `UAT-Task-02` is blocked by `UAT-Task-01` (UAT-031). Dates on both matter: an undated task has no bar, so UAT-044's arrow would have no second endpoint to reach.

### UAT-041 — List view and bulk edit
1. In the view switcher click **List**.
   - **Expected:** a table with header columns **Task, Status, Assignee, Priority, Score, Due, Labels** (plus custom-field columns when defined), one row per task. Each row has a checkbox; the header has a **Select all tasks** checkbox.
2. Tick `UAT-Task-02` and `UAT-Task-03`; in the bulk controls choose **Move to…** (**Move selected to column**) → `UAT-Col-Doing`.
   - **Expected:** both rows show Status `UAT-Col-Doing`. A WIP limit does not refuse the move — limits are advisory and render as `n/limit` when exceeded.
3. Re-tick both rows — the selection clears after each bulk action — then choose **Set priority…** → **High**.
   - **Expected:** both rows show High.
4. Re-tick both rows and choose **Assign to…** → your name.
   - **Expected:** both rows show you. Move both back to `UAT-Col-Todo` with **Move to…**.
5. Click a row's task title.
   - **Expected:** the Edit task dialog opens. **Cancel**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-042 — Calendar view
1. Click **Calendar**.
   - **Expected:** a month grid with **Previous month** / **Next month** arrows; `UAT-Task-01` appears on its due date.
2. Click the task entry.
   - **Expected:** its Edit dialog opens. **Cancel**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-043 — Timeline view
1. Click **Timeline**.
   - **Expected:** a **Timeline** panel draws horizontal bars over a date axis; `UAT-Task-01` has a bar spanning start→due. Clicking a bar opens the task dialog.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-044 — Gantt view with dependency arrow
1. Click **Gantt**.
   - **Expected:** a **Gantt** panel with bars and a dependency link drawn from `UAT-Task-01` to `UAT-Task-02` (the blocked-by edge).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-045 — Backlog view
1. Click **Backlog**.
   - **Expected:** tasks listed flat, grouped by sprint — all currently under a **Backlog** bucket (no sprints yet), which carries a count and points rollup. Scheduling is by dragging a card into a sprint bucket, not by a per-row control, so with no sprints the Backlog bucket is the only one (re-verified in UAT-055 once sprints exist). A blocked task shows its blocked-by count here.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-046 — Roadmap view
1. Click **Roadmap**.
   - **Expected:** a **Roadmap** panel. With no milestones yet it shows an empty state with a way to open Milestones. (Re-check after UAT-057: milestones appear with progress.)

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-047 — Dashboard view
1. Click **Dashboard**.
   - **Expected:** summary tiles/charts — counts per column and other rollups; clicking a listed task opens its dialog.
2. Click **Board** to return.
   - **Expected:** the drag-and-drop board returns.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 9 — Filters, search, saved views

### UAT-048 — Text search
1. On **Board** view, type `UAT-Task-01` in the **Search tasks** box.
   - **Expected:** only matching cards remain; a readout like **1 of N** appears plus a **Clear** button.
2. Click **Clear**.
   - **Expected:** all tasks reappear.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-049 — Facet filters, and NEGATIVE: no dragging while filtered
1. Click the **Priority** facet; tick **Urgent**.
   - **Expected:** only `UAT-Task-01` remains; the facet button shows a count badge `1`.
2. Also tick **Label** facet → `uat-bug` and **Assignee** facet → your name.
   - **Expected:** filters combine; "N of M" matches what is visible. The **Assignee** facet also offers **Unassigned** and lists agents with a robot icon once agents exist.
3. NEGATIVE: while filtered, try to drag a visible card.
   - **Expected:** dragging does not start (reordering a filtered subset is deliberately disabled). Clear the filter — dragging works again.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-050 — Save, apply, delete a view
1. Set view to **List**, set Priority facet **Urgent**. Click **Save** (next to **Views**); type `UAT-View-01` in **Name this view**; click the check button (**Save view**).
   - **Expected:** the **Views** button now reads **Views (1)**.
2. Switch to **Board**, **Clear** the filter. Open **Views**; click `UAT-View-01`.
   - **Expected:** the app returns to List view with the Urgent filter applied — lens and filter both restored.
3. In the **Views** dropdown, click the trash icon (**Delete view UAT-View-01**).
   - **Expected:** the view disappears; the count decrements.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 10 — Templates

### UAT-051 — Create a task template
1. Open **Templates** (⌘K → "Templates", or **Settings…** → *Board* → **Templates**).
   - **Expected:** the **Templates** dialog with a **New template** form: title (placeholder **Bug report**), **Template description** (placeholder **Steps to reproduce, expected vs actual…**), **Priority**, **Labels**, and an **Add template** button.
2. Create `UAT-Tmpl-01` with description `From template`, Priority **High**, label `uat-bug`; click **Add template**.
   - **Expected:** it appears in the list with an **Edit template** control.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-052 — Instantiate a template
1. In `UAT-Col-Todo` click **Add task**.
   - **Expected:** the New-task dialog now shows **Start from a template** (value **Blank task**).
2. Choose `UAT-Tmpl-01`.
   - **Expected:** Title, Description, Priority, Labels prefill; all remain editable.
3. Change the title to `UAT-Task-04`; click **Create task**.
   - **Expected:** created with the template's priority and label.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 11 — Sprints

### UAT-053 — Create sprints
1. Open **Sprints** (⌘K → "Sprints", or **Settings…** → *Planning* → **Sprints**).
   - **Expected:** the **Sprints** dialog shows **No sprints yet.** and a **New sprint** form: name (placeholder **Sprint 1**), **Sprint goal** (placeholder **Goal (optional)**), start and end date inputs, **Add**.
2. Create `UAT-Sprint-01` (goal `UAT goal`, start today, end +14 days) and `UAT-Sprint-02` (no dates).
   - **Expected:** both listed with status **Planning**, a progress bar, and `0/0 tasks · 0/0 pts`.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-054 — Schedule tasks into a sprint
1. Open `UAT-Task-01`.
   - **Expected:** a **Sprint** select now appears (value **Backlog**).
2. Choose `UAT-Sprint-01`; **Save changes**. Repeat for `UAT-Task-02`.
3. Reopen **Sprints**.
   - **Expected:** `UAT-Sprint-01` shows 2 tasks and summed points, with a per-assignee capacity breakdown (name · count · pts; agents would show a robot icon).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-055 — Backlog view sprint planning
1. Switch to the **Backlog** lens.
   - **Expected:** groups for `UAT-Sprint-01`, `UAT-Sprint-02`, and Backlog, tasks in the right groups.
2. Use the row control on `UAT-Task-03` to schedule it into `UAT-Sprint-01`, then back to Backlog.
   - **Expected:** the task moves between groups instantly and persists on reload.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-056 — Start and complete a sprint (rollover)
1. In **Sprints**, on `UAT-Sprint-01` click **Start**.
   - **Expected:** status becomes **Active**; **Start** is replaced by **Complete**.
2. Ensure `UAT-Task-01` is NOT in `UAT-Col-Done`, and drag `UAT-Task-02` INTO `UAT-Col-Done`.
3. Click **Complete** on `UAT-Sprint-01`.
   - **Expected:** an inline row appears: "Move unfinished tasks to" with a select (**Backlog** / `UAT-Sprint-02`) and a **Complete sprint** button.
4. Choose `UAT-Sprint-02`; click **Complete sprint**.
   - **Expected:** `UAT-Sprint-01` shows **Completed** (struck through). Open `UAT-Task-01` — its **Sprint** is now `UAT-Sprint-02` (unfinished work rolled over). `UAT-Task-02` (done) stayed in the completed sprint.
5. Open any Backlog task's **Sprint** select.
   - **Expected:** the completed sprint is not offered as a schedulable target (it appears, disabled and marked "(completed)", only on tasks already in it).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 12 — Milestones

### UAT-057 — Create a milestone and attach a task
1. Open **Milestones** (⌘K → "Milestones", or **Settings…** → *Planning* → **Milestones**).
   - **Expected:** **Milestones** dialog with a **New milestone** form (name placeholder **v1.0**, a **Milestone due date** input, optional **Epic** / **Objective** links).
2. Create `UAT-MS-01`, due +30 days.
   - **Expected:** listed with a progress bar.
3. Open `UAT-Task-01`; a **Milestone** select now exists; choose `UAT-MS-01`; **Save changes**.
4. Reopen **Milestones**, then switch to the **Roadmap** lens.
   - **Expected:** the milestone counts 1 task, and renders on the Roadmap with its progress.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 13 — Releases

### UAT-058 — Create a release and add tasks
1. Open **Releases** (⌘K → "Releases", or **Settings…** → *Planning* → **Releases**).
   - **Expected:** **Releases** dialog, **No releases yet.**, a name input (placeholder **v1.2.0**), an add button.
2. Create `UAT-Rel-01`.
   - **Expected:** listed with state chip **planned**, a progress bar, and buttons **Ship** and **Delete** (Delete asks **Really?** on first click).
3. Expand the release row; in **Add a task…** pick `UAT-Task-01`.
   - **Expected:** the task lists inside the release; the progress denominator updates.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-059 — Ship a release
1. On `UAT-Rel-01` click **Ship**.
   - **Expected:** the state chip flips to **released** (green); **Ship** disappears.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 14 — Epics and Objectives

### UAT-060 — Epics
1. Open **Epics** (⌘K → "Epics", or **Settings…** → *Planning* → **Epics**); in the **New epic** form (placeholder **Billing**) create `UAT-Epic-01`.
   - **Expected:** listed with progress.
2. Open `UAT-Task-01`; an **Epic** select now exists; choose `UAT-Epic-01`; **Save changes**. Reopen **Epics** — it counts 1 task.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-061 — Objectives and key results
1. Open **Objectives** (⌘K → "Objectives", or **Settings…** → *Planning* → **Objectives**); in the **New objective** form (name placeholder **Delight new users**, description placeholder **Why it matters (optional)**, an **Objective due date**) create `UAT-Obj-01`.
2. On the objective, add a key result: title placeholder **Key result (e.g. NPS)** → `UAT-KR NPS`, **Start** `0`, **Target** `10`, **Unit** `pts`.
   - **Expected:** the KR lists with 0% progress; updating its current value moves the progress bar.
3. Open `UAT-Task-01`; an **Objective** select now exists; choose `UAT-Obj-01`; **Save changes**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 15 — Custom fields

### UAT-062 — Define custom fields
1. Open **Custom fields** (⌘K → "Custom fields", or **Settings…** → *Board* → **Custom fields**).
   - **Expected:** **Custom fields** dialog, **No custom fields yet.**, a **New field** form: name (placeholder **Field name**), a **Field type** select, and for select-type fields an options input (**Options, comma separated**, placeholder **Low, Medium, High**).
2. Create `UAT-Severity` (type select, options `Low, Medium, High`) and `UAT-Account` (type text).
   - **Expected:** both listed.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-063 — Fill custom fields on a task
1. Open `UAT-Task-01`; scroll to the **Fields** section.
   - **Expected:** `UAT-Severity` (select) and `UAT-Account` (text) render.
2. Set Severity `High`, Account `Acme`; close and reopen the task.
   - **Expected:** both values persisted; the board card / List view show value chips for them.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 16 — Forms (intake)

### UAT-064 — Create a form
1. Open **Forms** (⌘K → "Forms", or **Settings…** → *Board* → **Forms**).
   - **Expected:** the **Forms** dialog: "Structured intake. A submission creates a task — the first answer becomes its title, the rest its description." Initially **No forms yet.**, with a **New form** builder: name (placeholder **Bug report**), **Form description** (placeholder **What this intake is for (optional)**), a **Target column** select (default **First column**), questions (placeholder **Question**) with an **Add question** control.
2. Create `UAT-Form-01` targeting `UAT-Col-Todo`, with questions `Summary?` and `Details?`; save it.
   - **Expected:** the form card lists showing its name and target column.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-065 — Submit a form creates a task
1. On the `UAT-Form-01` card click **Fill**.
   - **Expected:** the questions render as inputs.
2. Answer `UAT-Intake-01` and `Some details`; click **Submit**.
   - **Expected:** the fill form closes. A new task titled `UAT-Intake-01` appears in `UAT-Col-Todo`; opening it shows the remaining answers in the description.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 17 — Automations, state transition rules, SLA, inbound triggers

Automation rule authoring is admin-gated; you are owner so all controls show.

### UAT-066 — Create and enable a rule
1. Open **Automations** (⌘K → "Automations", or **Settings…** → *Board* → **Automations**).
   - **Expected:** the **Automations** dialog: a rule list (empty), a **New automation** builder (name placeholder **Move urgent bugs to the top**, a **Trigger event** select whose options include "a task is created", "a task is moved", "a task is edited", "a task is assigned", "a task's priority changes", "a task's dates change", "a task's labels change", "on a schedule", "an external tool fires it", plus git events), an **all of / any of** condition combinator with condition rows, and an action list with types **move, set_field, add_label, comment, notify, create_task, run script** and **assign**. Also visible: a **Describe an automation** box, an **SLA policies** section, an **Inbound triggers** section, and a **Workflow templates** section, plus the transitions matrix ("Enforce allowed column transitions").
2. Build rule `UAT-Rule-01`: When **a task's priority changes**, no conditions, Then **comment** with text `Priority changed (UAT)`. Save it.
   - **Expected:** the rule card appears, summarised as a sentence ("When a task's priority changes … then comment …"), marked **paused**.
3. On the rule card click **Enable**.
   - **Expected:** the paused chip disappears; the button now reads **Pause**.
4. Open `UAT-Task-03`; change **Priority** to **Low**; **Save changes**. Reopen the task.
   - **Expected:** a new comment `Priority changed (UAT)` posted by the automation appears in the thread.
5. Back in **Automations**, on the rule card click **Log**.
   - **Expected:** a run-log expands showing at least one successful run. Click **Hide log**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-067 — Describe an automation (AI draft never auto-enables)
1. In **Describe an automation**, type `When a PR merges, move it to Done`; click **Create review draft**.
   - **Expected:** a new rule draft appears in the list marked **paused** — the helper text promises "Creates a disabled draft for an admin to inspect and enable. It never activates a rule automatically." It must NOT be enabled. Delete it (cleanup).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-068 — NEGATIVE: enforced state-transition rules refuse a move
1. In **Automations**, tick **Enforce allowed column transitions**.
   - **Expected:** a from/to matrix of checkboxes appears (header "from ↓ / to →").
2. Allow ONLY `UAT-Col-Todo` → `UAT-Col-Doing` and `UAT-Col-Doing` → `UAT-Col-Done` (tick those two boxes, leave everything else unticked). Click **Save transitions** (it flips to **Saved**).
3. Close the dialog. Drag a task from `UAT-Col-Todo` directly to `UAT-Col-Done`.
   - **Expected:** the move is REFUSED — the card snaps back (board refetches) and/or an error is shown; the task remains in `UAT-Col-Todo`.
4. Drag it `UAT-Col-Todo` → `UAT-Col-Doing`.
   - **Expected:** allowed, succeeds.
5. Cleanup: reopen **Automations**, untick **Enforce allowed column transitions**, **Save transitions**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-069 — SLA policy
1. In the **SLA policies** section, create a policy: **SLA name** (placeholder **e.g. Urgent within 1h**) → `UAT-SLA-01`, **SLA target minutes** `60`, condition **SLA field** = priority, **SLA operator** equals, **SLA value** `urgent`, and an optional **SLA breach message** (placeholder **On breach, comment… (optional)**). Save.
   - **Expected:** the policy lists as `UAT-SLA-01 — 60m`.
2. Create a new task `UAT-Task-SLA` with Priority **Urgent**.
   - **Expected:** an SLA timer attaches to the task (visible as SLA/remaining info on the task or in the Requests view — see UAT-071). A real breach takes 60 minutes; you are not required to wait — timer attachment is the checkpoint.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-070 — Inbound trigger token
1. In the **Inbound triggers** section, type a name (placeholder **Name (e.g. n8n)**) `UAT-Trig-01` and mint it.
   - **Expected:** a row appears showing a full fire URL of the shape `…/api/board/<id>/triggers/<token>` to copy.
2. Optional (needs a terminal): `curl -X POST <that URL>`.
   - **Expected:** HTTP 2xx, and any rule with trigger "an external tool fires it" would run.
3. Revoke/delete the trigger.
   - **Expected:** the row disappears (the URL stops working).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 18 — Requests

### UAT-071 — Requests view
1. Switch to the **Requests** lens (**More views** → **Requests**, or **⋯** → *Intake* → **Requests**, or the chord `G Q`).
   - **Expected:** the **Requests** dialog opens — an intake queue of form-submitted tasks with requester and SLA info. `UAT-Intake-01` (from UAT-065) appears; with no submissions it would read **No requests yet.**

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 19 — Discovery (ideas and feedback)

### UAT-072 — Capture ideas and feedback
1. Open **Discovery** (⌘K → "Discovery", or **⋯** → *Intake* → **Discovery**).
   - **Expected:** the **Discovery** dialog with an ideas side (**New idea** input, placeholder **Capture an idea…**) and a feedback side (**New feedback**, placeholder **What did a customer or stakeholder say?**, plus **Source** placeholder **Source (e.g. Acme, sales)** and a **Sentiment** select).
2. Add idea `UAT-Idea-01`. Add feedback `Customer wants UAT-Idea-01` with source `Acme`.
   - **Expected:** both listed. Idea rows expose scoring inputs (**Reach**, **Impact 1-5**, **Confid %**, **Effort wk**) that compute a score, an upvote control (**Upvote feedback** on feedback), and a **File under idea** select on feedback rows.
3. File the feedback under `UAT-Idea-01`.
   - **Expected:** the feedback attaches to (counts under) the idea.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-073 — Promote an idea to a task
1. On `UAT-Idea-01` click **Promote**.
   - **Expected:** the button changes to **Promoted**; a new task carrying the idea's title/detail appears on the board.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 20 — Programs, Portfolio, Scaled Agile

### UAT-074 — Programs
1. Sidebar → **Programs**.
   - **Expected:** the **Programs** dialog with a **New program name** input (placeholder **New initiative (e.g. Mobile)**).
2. Create `UAT-Prog-01`; assign board `UAT-Board-01` to it (board assignment control on the program row).
   - **Expected:** the program lists with its boards; boards not in any program show under **Unassigned**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-075 — Portfolio
1. Sidebar → **Portfolio**.
   - **Expected:** the **Portfolio** dialog — a cross-board rollup for the workspace: per-board (and per-program) task totals/progress including `UAT-Board-01`'s numbers, consistent with the board's actual counts.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-076 — Scaled Agile (teams)
1. Sidebar → **Scaled Agile**.
   - **Expected:** the **Scaled Agile** dialog with a **New team name** input (placeholder **New team…**), and sections showing teams, their boards/members, and a **Portfolio** layer. Empty states read **No teams yet.** / **No boards yet.** / **No members.**
2. Create team `UAT-Team-01`; assign board `UAT-Board-01` and yourself to it.
   - **Expected:** the team lists its board and member; the portfolio layer reflects the team grouping.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 21 — Insights, Reports, Schedule, Timesheet, Capacity, Budget, Export

### UAT-077 — Board insights
1. Open **Insights** (⌘K → "Insights", or **⋯** → *Measure* → **Insights**).
   - **Expected:** the **Board insights** dialog (may briefly show "Crunching the log…") with flow analytics: cumulative flow ("Cumulative flow, last 30 days"), cycle/lead time, per-column and per-assignee stats, and a **Risks — explainable delivery signals** section listing at-risk tasks with reasons.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-078 — Custom report
1. Sidebar → **Reports**.
   - **Expected:** the **Reports** dialog/panel: **No reports yet.**, a **Report name** input, source/grouping/metric selects, and a viz choice **Bar / Line / Table**.
2. Create `UAT-Rep-01` (e.g. source tasks, group by column, metric count, viz **Bar**); run it.
   - **Expected:** a bar chart/table renders with numbers matching the board. The report persists in the list; a **Delete report** control exists.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-079 — Schedule proposal (CPM)
1. Open **Schedule** (⌘K → "Schedule", or **⋯** → **Schedule**).
   - **Expected:** a dialog that computes a **Proposed schedule** (may show "Planning…") — proposed start/due dates per task honouring the dependency `UAT-Task-01` → `UAT-Task-02`, with an **Apply** action.
2. Apply it.
   - **Expected:** the affected tasks' dates update (verify on one task).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-080 — Timesheet
1. Open **Timesheet** (⌘K → "Timesheet", or **⋯** → *Measure* → **Timesheet**).
   - **Expected:** the **Timesheet** dialog: a week grid with **Previous week** / **Next week** arrows, an **All**/member filter, rows for logged time (the 30 min from UAT-034 appears on today), and a **Total** row showing 0:30.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-081 — Capacity
1. Open **Capacity** (⌘K → "Capacity", or **⋯** → *Measure* → **Capacity**).
   - **Expected:** the **Capacity** dialog: per-person (and agent) demand vs capacity for the workspace; your open assigned points appear; a **Role** input / weekly capacity setting exists for admins; unassigned work shows under **Unassigned**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-082 — Budget
1. Open **Budget** (⌘K → "Budget", or **⋯** → *Measure* → **Budget**).
   - **Expected:** the **Budget** dialog with **Budget amount** (placeholder **none**), **Hourly rate**, **Currency**, and a **Save budget** button.
2. Set amount `1000`, rate `50`; **Save budget**.
   - **Expected:** saved; spend derived from logged time (0.5 h × 50 = 25) shows against the 1000 budget.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-083 — Export CSV and JSON
1. Open **⋯** and click **Export CSV**.
   - **Expected:** the browser downloads a .csv containing the board's tasks (open it: UAT task titles present, with column/priority/label data).
2. **Export** → **JSON**.
   - **Expected:** a .json download with the same tasks as structured data.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 22 — Docs (wiki)

### UAT-084 — Create pages (page / meeting / decision)
1. Sidebar → **Docs**.
   - **Expected:** the **Docs** dialog: a page tree sidebar with a **Search** box, buttons to add a **Page**, **Meeting**, and **Decision** doc, and an empty state "Create a page to start the wiki."
2. Create a Page; title it `UAT-Doc-01` (**Document title** field); in the body write `# Heading` and `See [[UAT-Doc-02]]`; click **Save**.
   - **Expected:** saved; the tree lists `UAT-Doc-01`.
3. Create a second Page `UAT-Doc-02`; **Save**.
4. Reopen `UAT-Doc-01`.
   - **Expected:** in preview the `[[UAT-Doc-02]]` wikilink resolves to a link to that doc; the heading renders as a heading (safe Markdown, no raw HTML).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-085 — Meeting doc: promote an action item to a task
1. Create a **Meeting** doc `UAT-Doc-Meet`; its template includes a **Proposed action items** area. In the body add a line: `- [ ] UAT follow up task`. **Save**.
2. Click **Review actions** / **Promote action**.
   - **Expected:** a task titled `UAT follow up task` is created on the board (empty state text would be "No unchecked Markdown actions found." if the line were missing).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-086 — Doc history and publish
1. On `UAT-Doc-01`, edit the body and **Save** again; open **History**.
   - **Expected:** previous revisions are listed (before your edits it reads "No saved revisions yet.").
2. Toggle the **Published** control on `UAT-Doc-01`.
   - **Expected:** the doc is marked published (published docs are searchable by the knowledge Q&A — used in UAT-090).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 23 — Chat

### UAT-087 — Channels and messages
1. Sidebar → **Chat**.
   - **Expected:** the chat dialog with a channel sidebar (empty state "Create a channel."), a **Channel name** input (placeholder **new-channel**) with **Add**.
2. Create channel `uat-general`; select it; type `Hello from UAT` in the **Message** box (placeholder **Write a message…**); click **Send**.
   - **Expected:** the message appears with your name and time (empty channel reads "No messages yet." before).
3. As **account B** (after B joins the workspace in Suite 25 — return here if needed): open Chat → `uat-general`.
   - **Expected:** B sees the message; replies from B appear for A (polling refresh — allow a few seconds).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 24 — Whiteboards

### UAT-088 — Create and draw on a whiteboard
1. Sidebar → **Whiteboards**.
   - **Expected:** the whiteboards dialog (empty state "Create a whiteboard."), a **Board name** input with **Add**.
2. Create `UAT-WB-01`; open it.
   - **Expected:** an Excalidraw-style drawing canvas loads.
3. Draw a rectangle and some text; close and reopen the whiteboard.
   - **Expected:** the drawing persisted (autosave).
4. Use **Add task card…** (**Task to add**) to place `UAT-Task-01` on the canvas.
   - **Expected:** a card element appears on the canvas linking back to the task.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 25 — Knowledge Q&A (Ask)

### UAT-089 — Ask a workspace question
**Preconditions:** UAT-086 published `UAT-Doc-01`; tasks and comments exist. Note: answer generation may require an LLM key — if the answer errors for that reason, mark Blocked with a note; the search/citation plumbing is still the checkpoint.
1. Sidebar → **Ask** (sparkles icon).
   - **Expected:** the **Workspace Q&A** dialog: "Searches authorized tasks, comments, and published documents. Every answer is backed by citations." with a question input (placeholder **What is blocking the launch?**) and an **Ask** button.
2. Type `What UAT tasks exist?` and click **Ask** (button shows **Searching…**).
   - **Expected:** an answer paragraph appears with a **Sources** list of citations (kind · title, with excerpts) drawn only from this workspace's content.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 26 — Webhooks

### UAT-090 — Register a webhook and receive an event
**Preconditions:** *Requires external setup:* an HTTPS endpoint you can inspect (e.g. a webhook.site URL). Without one, do steps 1–3 and mark the delivery checkpoint Blocked.
1. Open the board switcher → **Webhooks** (admin-only entry; also reachable at **Settings** → *Workspace* → **Webhooks**).
   - **Expected:** the **Webhooks** dialog: **No webhooks yet.**, **Endpoint URL** (placeholder **https://example.com/hooks/kanban**) and **Events (optional)** (placeholder **task.created, task.moved — empty for all**).
2. Register your receiver URL with events blank; save.
   - **Expected:** the webhook lists as active, showing a signing secret.
3. Create a throwaway task `UAT-Task-WH`.
   - **Expected (external):** the receiver gets a signed POST (HMAC signature header) describing `task.created`.
4. Delete the webhook and the task (cleanup).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 27 — Members, roles, invitations

### UAT-091 — Invite account B (member)
1. Board switcher → **Members**.
   - **Expected:** the **Members** dialog "Who can access UAT-WS-01." with an **Invite by email** field (placeholder **teammate@company.com**), an **Invite role** select (**owner, admin, member, viewer, guest** — owner only offered because you are owner), an **Invite** button, and the note "No email is sent yet — they join automatically the next time they sign in with this address."
2. Enter account B's GitHub email address, role **member**; click **Invite**.
   - **Expected:** B's email appears under **Pending invitations** with role member and a revoke (X) control.
3. As **account B**, sign out/in (or sign in for the first time) at the app origin.
   - **Expected:** B lands in workspace `UAT-WS-01` (the invitation redeemed on sign-in). In A's Members dialog, B moves from Pending invitations into the member list.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-092 — NEGATIVE: viewer cannot edit
1. As account A, in **Members**, change B's role select to **viewer**.
2. As account B, reload the app and open board `UAT-Board-01`.
   - **Expected:** header hint reads "You have view-only access to this workspace." There is NO **Add task**, NO **Add column**, no column **⋯** menus, no card **⋯** menus; dragging cards does nothing. Read surfaces (Labels dialog, views, Export) still work.
3. As B, open a task from the List view.
   - **Expected:** task content is readable but B cannot post comments as an editor would — and B has NO **Resolve** button on comment threads (resolve is member-gated).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-093 — Role changes and removal safeguards
1. As A, set B back to **member**. As B, reload.
   - **Expected:** B can now add/edit tasks again.
2. As A, try to change your own (the only owner's) role to member, or remove yourself.
   - **Expected:** refused — the server protects the last owner (an error message appears; you remain owner).
3. Revoke flow: invite `uat-nobody@example.com` as viewer, then click the X (**Revoke invitation for uat-nobody@example.com**).
   - **Expected:** the pending invitation disappears.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 28 — Workspace administration and enterprise controls

All as account A (owner). The admin surface is **Settings** (sidebar → **Settings**, or **⋯** → **Settings…**); its *Workspace* group holds the sections below.

### UAT-094 — Console summary and shortcuts
1. Open **Settings** and select *Workspace* → **Overview**.
   - **Expected:** dialog "Central workspace administration for UAT-WS-01." with a summary grid — **N members, N agents, N boards, N active webhooks, N audit events** — and shortcut buttons **Members**, **Agents**, **Webhooks** that open those dialogs. Below: sections **Board permissions**, **IP allowlist**, **Retention**, **Legal holds** (with a workspace search **Search tasks, comments, docs, audit** and **Export JSON**), **Identity providers**, **Work integrations** (**Connect Slack**, **Connect Google Workspace**, **Connect Microsoft 365**, **Connect Teams**), and **Extensions**.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-095 — Board permission grant
1. In **Board permissions**, choose **Board** = `UAT-Board-01`, **Workspace role** = `viewer`, **Capability** = `write`; click **Grant**.
   - **Expected:** a grant row appears ("Board #N: viewer → write") with a **Revoke board permission** trash control.
2. Optional deep check: set B to viewer again — B can now edit tasks on `UAT-Board-01` only. Revoke the grant and restore B to member.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-096 — IP allowlist entry
1. In **IP allowlist** (owner-only), enter **CIDR range** `203.0.113.0/24`, label `Office (optional)` placeholder → `UAT office`; click **Add**.
   - **Expected:** the entry lists. Note on screen: "Enforcement is active only when the deployment enables it with a trusted proxy header." — you are NOT locked out in dev.
2. Remove the entry (trash control).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-097 — Retention, legal hold, eDiscovery export
1. In **Retention**, set a policy (record type + **Retention days** e.g. `365`); **Save**.
   - **Expected:** saved without error.
2. In **Legal holds**, add a hold: record type task, **ID** = a UAT task's id, **Reason** `UAT hold`.
   - **Expected:** the hold lists with a **Release legal hold** control.
3. In the eDiscovery search (**Search tasks, comments, docs, audit**) search `UAT`; click **Export JSON**.
   - **Expected:** matching records appear and a JSON bundle downloads.
4. Release the hold (cleanup).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-098 — Identity providers / SCIM (external)
**Preconditions:** *Requires external setup:* a real OIDC or SAML IdP.
1. In **Identity providers**, verify the form: protocol select (**OIDC**/**SAML**), **Provider ID**, **Issuer URL**, **company.com** domain field; OIDC shows **Client ID / Client secret / Discovery URL**; SAML shows **IdP entry point / Signing certificate / Callback URL**; an **Add provider** button.
2. With a real IdP: add it, then click **SCIM token**.
   - **Expected:** "Copy this SCIM token now: …" appears exactly once; SSO sign-in from the configured domain works. Without an IdP, verifying the form renders is the Pass condition for this case; mark the SSO checkpoint Blocked.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-099 — Work integrations (external)
**Preconditions:** *Requires external setup:* Slack app credentials, Microsoft Teams webhook URL, Google/M365 OAuth apps.
1. In **Work integrations**, verify the buttons **Connect Slack**, **Connect Google Workspace**, **Connect Microsoft 365**, and the **Connect Teams** form (**Teams channel / conversation ID**, **Teams webhook URL**, **Name (optional)**).
2. If credentials exist, connect one and send a test notification via an automation **notify** action targeting it. Otherwise mark Blocked beyond the render check.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-100 — Git repository connection (external)
**Preconditions:** *Requires external setup:* a GitHub App installed on a test repository.
1. Open the **Repositories** dialog (git/development integrations entry; reachable from the tools/extension actions area).
   - **Expected:** a **Provider** select (github/gitlab/bitbucket), **Repository** (placeholder **owner/name**), **Install id (optional)** (placeholder **GitHub App installation id**).
2. With a real connection: connect a repo, push a branch named `feature/<taskId>-uat`, open a PR referencing `#<taskId>`.
   - **Expected:** the task's **Development** section lists the branch/PR with state chips, and git events appear as automation triggers. Without external setup, the render check is the Pass condition; mark the rest Blocked.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 29 — Agents (AI) and the MCP door

### UAT-101 — Create an agent
1. Board switcher → **Agents** (or **Settings** → *Workspace* → **Agents**).
   - **Expected:** the **Agents** dialog with an **Add an agent** form: name (placeholder **Triage Bot**), **Agent kind**, **Agent role**, **Model** (placeholder **claude-opus-4-8**), **System prompt (optional)**, **Monthly budget cap** (placeholder **Uncapped**).
2. Create `UAT-Agent-01`.
   - **Expected:** the agent lists. It now appears: in the task dialog's **Assignee** select under an **Agents** group, and in the filter bar's **Assignee** facet with a robot icon.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-102 — Assign a task to an agent
1. Open `UAT-Task-03`; set **Assignee** to `UAT-Agent-01` (Agents group); **Save changes**.
   - **Expected:** the card shows the agent (robot icon) as assignee; Sprints/Capacity count the agent beside humans.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-103 — Agent run review (accept/reject)
**Preconditions:** *Requires external setup:* the agent runtime configured with a real LLM API key, and a completed agent run on a task.
1. Open a task that has an agent run.
   - **Expected:** a **Proposed changes — accept or reject** section sits above the comments; accepting applies the changeset and logs to History; rejecting/undo reverts. Without a run, the section renders nothing — mark Blocked.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

### UAT-104 — MCP door (agent API)
**Preconditions:** *Requires external setup:* an agent token minted (`npm run create-agent`) and an MCP client (e.g. Claude Code) configured against `mcp/server.mjs`.
1. From the MCP client, call `list_board`, then `create_task` (title `UAT-MCP-01`), then `move_task`, then `comment_on_task`.
   - **Expected:** each call succeeds; the board reflects the changes live; the task's **History** attributes the actions to the agent, and gated actions follow the approval tiers. Without the setup, mark Blocked.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 30 — Notifications

### UAT-105 — Mention creates a notification
**Preconditions:** Account B is a member (UAT-093). Know B's display name for mentions.
1. As account A, comment on `UAT-Task-01`: `@<B's name> please review` (use the mention syntax the comment box offers).
2. As account B, look at the bell button in the header.
   - **Expected:** the bell shows an unread indicator (its tooltip/aria reads "Notifications, N unread").
3. As B, click the bell.
   - **Expected:** a panel lists the mention (who, which task); opening/viewing marks it seen — the unread badge clears (aria returns to "Notifications").

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 31 — Sign-out

### UAT-106 — Sign out
1. As account A, click your avatar at the bottom of the sidebar (**Account**).
   - **Expected:** a menu opens showing your name/email and a **Sign out** item.
2. Click **Sign out**.
   - **Expected:** you are returned to `/sign-in`. Navigating to the app origin redirects back to `/sign-in` (session gone).
3. Sign in again (for the regression sweep).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## Suite 32 — Final regression sweep

### UAT-107 — End-to-end sweep
Run through this condensed checklist in one pass; any single failure fails the case.
1. Sign in → `UAT-Board-01` loads with all UAT columns and tasks intact (nothing lost during the run).
2. Create a task, drag it across all three columns, delete it.
3. Open `UAT-Task-01`: fields, subtask, checklist, dependency, attachment, time total, comments, and History all present and consistent.
4. Flip through all nine lenses — the four tabs (**Board → List → Timeline → Dashboard**) and the five under **More views** (**Calendar → Gantt → Backlog → Roadmap → Requests**) — each renders without error.
5. Filter by **Urgent** + `uat-bug`, clear.
6. Open the **⋯** menu — it must open without crashing the board — and every panel behind it once: **Schedule**, *Measure* (**Insights, Timesheet, Capacity, Budget**), *Intake* (**Requests, Discovery**). Then **Settings…** and each of its *Board* and *Planning* sections (**Labels, Custom fields, Templates, Automations, Forms, Sprints, Milestones, Releases, Epics, Objectives**). Each opens and closes cleanly.
7. Open each sidebar tool once (**Ask, Docs, Chat, Whiteboards, Programs, Scaled Agile, Portfolio, Reports, Settings**) — each opens and closes cleanly.
8. **⋯ → Export CSV** downloads and contains the UAT tasks.
9. Browser console (F12) shows no uncaught errors during steps 1–8.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________

---

## 4. Sign-off

| Field | Value |
|---|---|
| Tester name | |
| Date(s) of execution | |
| Build / commit under test | |
| Environment (URL, browser + version, OS) | |
| Total cases: Passed / Failed / Blocked | ____ / ____ / ____ |
| Critical failures (case IDs) | |
| Overall verdict | ☐ Accepted ☐ Accepted with reservations ☐ Rejected |
| Tester signature | |
| Product owner signature | |

**Cleanup after sign-off:** delete all `UAT-` prefixed workspaces, boards, tasks, labels, sprints, milestones, releases, epics, objectives, templates, forms, automations, docs, channels, whiteboards, reports, agents, and webhooks — or reset the test database (`docker compose down -v`).
