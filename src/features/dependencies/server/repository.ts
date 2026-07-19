import type { PoolClient } from "pg";

import { query, withTransaction } from "@/shared/db/client";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import type { Principal } from "@/features/auth/server/principal";
import type { TaskDependencies, TaskDependencyRef } from "../types";

/**
 * The advisory-lock classifier for dependency writes. pg_advisory_xact_lock's key
 * space is global and shared by any caller, so the two-int form namespaces this
 * lock's board key under a constant nothing else uses — see addDependency for why
 * the board is the thing being locked at all.
 */
const DEPENDENCY_LOCK_CLASS = 0x7de9;

/**
 * A task's blockers, title-bearing and ordered for display.
 *
 * "viewer", matching listSubtasks and the checklist read: seeing what a task
 * waits on is reading the task, not editing it. Ordered by title so the list is
 * stable and scannable rather than in insertion order; id breaks ties.
 */
async function listDependencies(taskId: number): Promise<TaskDependencyRef[]> {
  return query<TaskDependencyRef>(
    `SELECT t.id, t.title
       FROM task_dependency d
       JOIN task t ON t.id = d.depends_on_task_id
      WHERE d.task_id = $1
      ORDER BY t.title, t.id`,
    [taskId]
  );
}

/**
 * The tasks this one could take on as a blocker: same board, never itself, never
 * an existing blocker, and never a task that already depends on this one.
 *
 * That last exclusion is the picker's half of cycle prevention. `dependents` is
 * every task that transitively depends on taskId — walked along the reverse edge
 * (task_id where depends_on_task_id = current) out from taskId. If taskId were to
 * depend on any of them, the graph would close a loop, so they are removed from
 * the options. The server still refuses a cycle on write (addDependency); this
 * only keeps the UI from offering a choice it would reject.
 *
 * UNION, not UNION ALL: a diamond in the graph would otherwise walk the same node
 * twice, and on a genuine cycle (which this table's writes forbid, but a read must
 * not assume) UNION ALL would not terminate. UNION dedupes on each step, which
 * bounds the walk at the number of tasks.
 */
async function listCandidates(
  taskId: number,
  boardId: number
): Promise<TaskDependencyRef[]> {
  return query<TaskDependencyRef>(
    `WITH RECURSIVE dependents AS (
       SELECT task_id AS id FROM task_dependency WHERE depends_on_task_id = $1
       UNION
       SELECT d.task_id
         FROM task_dependency d
         JOIN dependents dp ON d.depends_on_task_id = dp.id
     )
     SELECT t.id, t.title
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $2
        AND t.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM task_dependency e
           WHERE e.task_id = $1 AND e.depends_on_task_id = t.id)
        AND t.id NOT IN (SELECT id FROM dependents)
      ORDER BY t.title, t.id`,
    [taskId, boardId]
  );
}

export async function getDependencies(
  actor: string | Principal,
  taskId: number
): Promise<TaskDependencies> {
  const { boardId } = await requireTaskRole(actor, taskId, "viewer");
  const [dependencies, candidates] = await Promise.all([
    listDependencies(taskId),
    listCandidates(taskId, boardId),
  ]);
  return { dependencies, candidates };
}

/**
 * Would `dependsOnId` reach `taskId` by following depends-on edges? If so, adding
 * "taskId depends on dependsOnId" closes a cycle.
 *
 * The walk starts at dependsOnId's own blockers and follows depends_on forward:
 * the new edge would make taskId depend on dependsOnId, so a path from dependsOnId
 * back to taskId means taskId already (transitively) comes before its own
 * prerequisite. UNION for listCandidates' reason — dedupe bounds the walk and
 * survives any pre-existing cycle a read must not loop on.
 *
 * Runs on the caller's transaction client, under the board lock addDependency
 * holds, so the graph it reads cannot shift before the INSERT that trusts it.
 */
async function wouldCycle(
  client: PoolClient,
  taskId: number,
  dependsOnId: number
): Promise<boolean> {
  const { rows } = await client.query<{ reached: boolean }>(
    `WITH RECURSIVE reach AS (
       SELECT depends_on_task_id AS id
         FROM task_dependency WHERE task_id = $1
       UNION
       SELECT d.depends_on_task_id
         FROM task_dependency d
         JOIN reach r ON d.task_id = r.id
     )
     SELECT EXISTS (SELECT 1 FROM reach WHERE id = $2) AS reached`,
    [dependsOnId, taskId]
  );
  return rows[0].reached;
}

/**
 * Records that `taskId` is blocked by `dependsOnId` (018).
 *
 * Mirrors assertDecomposable (008): the caller must be a member of the task being
 * changed, the referenced task must resolve on the *same board*, and the id space
 * must not become an oracle. requireTaskRole gives all three — a blocker in
 * another workspace answers not_found (a stranger cannot tell a real id from a
 * fake one), a blocker on another board of a workspace the caller does belong to
 * answers forbidden (leaks nothing they cannot already see). "member" on both,
 * because declaring a dependency is a board mutation, the rank createTask and
 * addSubtask already demand.
 *
 * The board lock is what makes the cycle check an invariant rather than a
 * suggestion — see 018 for why the board, and not the two tasks, is the thing
 * that must be locked. It is taken first inside the transaction, so every write
 * that could interact with this one serializes here, and wouldCycle reads a graph
 * that cannot change under it before the INSERT lands.
 *
 * Idempotent: re-adding an existing blocker writes nothing and is not an error,
 * the rule claimTask's re-claim and the checklist's no-op share — an agent
 * retrying a dropped request must not be told the edge it already created is a
 * conflict. A genuine cycle is the conflict: the caller is allowed to attempt it,
 * the graph's shape refuses it, which is the 409 members.ts and columns.ts draw.
 */
export async function addDependency(
  actor: string | Principal,
  taskId: number,
  dependsOnId: number
): Promise<void> {
  if (taskId === dependsOnId) {
    throw new AuthzError("conflict", "A task cannot depend on itself");
  }
  const { boardId } = await requireTaskRole(actor, taskId, "member");
  const blocker = await requireTaskRole(actor, dependsOnId, "member");
  if (blocker.boardId !== boardId) {
    throw new AuthzError(
      "forbidden",
      "A task can only depend on another task on the same board"
    );
  }

  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      DEPENDENCY_LOCK_CLASS,
      boardId,
    ]);

    if (await wouldCycle(client, taskId, dependsOnId)) {
      throw new AuthzError(
        "conflict",
        "That would create a circular dependency"
      );
    }

    await client.query(
      `INSERT INTO task_dependency (task_id, depends_on_task_id)
       VALUES ($1, $2)
       ON CONFLICT (task_id, depends_on_task_id) DO NOTHING`,
      [taskId, dependsOnId]
    );
  });
}

/**
 * Removes the "taskId is blocked by dependsOnId" edge. Returns false if there was
 * no such edge the caller could remove — the checklist delete's shape, so the
 * route answers 404 rather than pretending a no-op succeeded.
 *
 * "member" on taskId, the same rank the add demanded: removing a blocker is
 * editing the blocked task. No board lock and no cycle check — deleting an edge
 * can only shrink the graph, and nothing that shrinks it can create a cycle.
 * dependsOnId is not re-authorized: the caller already proved member on taskId's
 * board, and a delete keyed on both ids touches only an edge that starts at a
 * task they may edit.
 */
export async function removeDependency(
  actor: string | Principal,
  taskId: number,
  dependsOnId: number
): Promise<boolean> {
  await requireTaskRole(actor, taskId, "member");
  const rows = await query<{ taskId: number }>(
    `DELETE FROM task_dependency
      WHERE task_id = $1 AND depends_on_task_id = $2
      RETURNING task_id AS "taskId"`,
    [taskId, dependsOnId]
  );
  return rows.length > 0;
}
