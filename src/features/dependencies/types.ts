/**
 * A task referenced in a dependency relationship — just enough to name it (018).
 *
 * id and title, never the whole Task: the "Blocked by" list and the picker below
 * it render a name and link to open the task, and nothing on either needs a
 * card's worth of fields. A blocker can be any task on the board, including a
 * subtask that never reaches it, so the title has to travel from the server —
 * the board's client-side task list cannot be assumed to hold it.
 */
export interface TaskDependencyRef {
  id: number;
  title: string;
}

/**
 * What one task's dependency section needs in a single fetch: the blockers it
 * already has, and the tasks it could add as blockers.
 *
 * Both in one payload rather than two round trips, because the section shows
 * both the moment it mounts — the current list and the "add" picker's options.
 * Candidates are server-authoritative: same board, never self, never an existing
 * blocker, and never a task that (transitively) depends on this one, since adding
 * that would close a cycle. The server refuses a cycle on write regardless; this
 * just keeps the picker from offering a choice it would reject.
 */
export interface TaskDependencies {
  /** Tasks this task is blocked by — its dependencies. */
  dependencies: TaskDependencyRef[];
  /** Same-board tasks that could be added as a blocker without cycling. */
  candidates: TaskDependencyRef[];
}

export interface AddDependencyInput {
  /** The task that must finish first — the blocker this task will depend on. */
  dependsOnId: number;
}
