/**
 * Who performed an action. Agents cannot act until M2, but the type is actor-
 * shaped from the first row: the log is append-only, so a schema that assumed a
 * human actor would leave every M1 row permanently unable to say otherwise.
 */
export type ActorType = "human" | "agent";

export interface Actor {
  type: ActorType;
  /** A user id today; an agent id from M2. Polymorphic, hence unconstrained. */
  id: string;
}

/**
 * The source of truth for the `action` column, which is TEXT in Postgres — this
 * set grows every milestone, and an enum would need a migration each time.
 */
export type ActivityAction =
  | "task.created"
  | "task.updated"
  | "task.moved"
  | "task.deleted"
  /**
   * Assignment gets its own action rather than folding into task.updated, for
   * three reasons that all point the same way. It reads as a distinct event in
   * the feed ("assigned this to Bob" beats "updated this task"). Its inverse is
   * distinct, so undo (M2) can revert an assignment without reverting an edit
   * that rode along in the same PATCH. And at M2 assigning a task to an agent is
   * what *triggers a run* — the one action the whole wedge hangs off needs to be
   * findable in the log, not inferred by diffing snapshots.
   *
   * Covers assign, reassign, and unassign — all three are "the assignee
   * changed", and `before`/`after` say which.
   */
  | "task.assigned";

/** What a task looked like at one instant. `before`/`after` hold these. */
export interface TaskSnapshot {
  title: string;
  description: string;
  columnId: number;
  position: number;
  /**
   * Optional because the log is append-only and this field arrived at 004: rows
   * written before it genuinely have no such key, and no backfill can invent
   * one — nobody knows who those tasks were assigned to, because nobody could
   * assign them. `undefined` means "written before assignees existed"; `null`
   * means "was unassigned". Every row written from here on sets it.
   */
  assigneeId?: string | null;
}

export interface Activity {
  id: string;
  workspaceId: string;
  boardId: number | null;
  taskId: number | null;
  actorType: ActorType;
  actorId: string;
  action: ActivityAction;
  before: TaskSnapshot | null;
  after: TaskSnapshot | null;
  createdAt: string;
}

/** An activity joined to the human who caused it, for rendering. */
export interface ActivityEntry extends Activity {
  /** Null when the actor is an agent, or a user who has since been deleted. */
  actorName: string | null;
  actorImage: string | null;
}
