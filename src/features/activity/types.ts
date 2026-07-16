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
 *
 * Split by subject rather than left flat, because at 005 the log stopped being
 * about only tasks. `action` now says which *kind of thing* an entry describes,
 * and therefore which snapshot shape `before`/`after` hold — see Activity below.
 */
export type TaskAction =
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

/**
 * Comments are logged like any other mutation (M1's criterion is that *every*
 * mutation writes a row), and §7.1 makes comment_on_task an agent tool whose
 * every call must be audited. The comment itself lives in its own table — the
 * log records that it was said, not the saying of it.
 */
export type CommentAction =
  | "comment.created"
  | "comment.updated"
  | "comment.deleted";

/**
 * Columns are the states an agent moves tasks between (PRD §9), so who changed
 * the workflow is audit-relevant in its own right — at M5 these same columns
 * become automation triggers.
 *
 * These rows carry a null `taskId`: the subject is the column, and the board is
 * what locates it. Nothing renders them yet, since M1 shows per-task history
 * only — which is exactly the case 003 recorded `board_id` for, and the reason a
 * board-level feed can be built later without a backfill that is impossible by
 * then. Written now because the criterion is that *every* mutation writes a row,
 * and because M2's undo replays them.
 */
export type ColumnAction =
  | "column.created"
  | "column.updated"
  | "column.moved"
  | "column.deleted";

export type ActivityAction = TaskAction | CommentAction | ColumnAction;

/** What a task looked like at one instant. */
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

/**
 * What a comment looked like at one instant.
 *
 * Carries its own id, where TaskSnapshot does not: an entry about a task is
 * identified by the row's own task_id column, but an entry about a comment has
 * that column pointing at the comment's *parent*. Without commentId here, a task
 * with twenty comments would log twenty indistinguishable edits, and M2's undo
 * would have nothing to aim at. It rides in the JSONB rather than becoming a
 * column on activity_log because nothing queries history *by comment* — the feed
 * reads per task — and a column would earn its keep only if something did.
 *
 * `author` is recorded even though the row already names an actor, because for
 * comment.deleted the two genuinely differ: an admin may delete someone else's
 * remark. Recording only the actor would make the authorship of a deleted
 * comment unrecoverable, and 003's lesson is that on an append-only table a
 * field skipped is a window of history lost for good.
 */
export interface CommentSnapshot {
  commentId: number;
  body: string;
  author: Actor;
}

/**
 * What a column looked like at one instant.
 *
 * Carries its own id for the reason CommentSnapshot does — the row's task_id
 * cannot identify it, and here it is null outright. `title` is what makes a
 * deleted column's entries still readable: the feed resolves column names by id
 * against a board that no longer has the column, so without the title recorded
 * here, the record of a deletion could never name what was deleted.
 */
export interface ColumnSnapshot {
  columnId: number;
  title: string;
  position: number;
}

export type Snapshot = TaskSnapshot | CommentSnapshot | ColumnSnapshot;

interface ActivityBase {
  id: string;
  workspaceId: string;
  boardId: number | null;
  /** The task the entry is about — or, for a comment, the task it was made on. */
  taskId: number | null;
  actorType: ActorType;
  actorId: string;
  createdAt: string;
}

/**
 * An entry is a discriminated union on `action`, so a reader that switches on it
 * — which every reader already does, to phrase the entry — gets the matching
 * snapshot type for free, and cannot reach for `.columnId` on a comment.
 *
 * The runtime is looser than this type, deliberately and per 003: `action` is
 * TEXT, so a row written by newer code can reach older code carrying an action
 * this union has never heard of. That is why readers need a default branch;
 * the union describes what we write, not the full space of what we may read.
 */
export interface TaskActivity extends ActivityBase {
  action: TaskAction;
  before: TaskSnapshot | null;
  after: TaskSnapshot | null;
}

export interface CommentActivity extends ActivityBase {
  action: CommentAction;
  before: CommentSnapshot | null;
  after: CommentSnapshot | null;
}

export interface ColumnActivity extends ActivityBase {
  action: ColumnAction;
  before: ColumnSnapshot | null;
  after: ColumnSnapshot | null;
}

export type Activity = TaskActivity | CommentActivity | ColumnActivity;

/**
 * An activity joined to the human who caused it, for rendering.
 *
 * An intersection rather than an `extends`, because Activity is a union: the
 * intersection distributes across both members and each keeps its own snapshot
 * types, where a single interface extending the union would collapse them.
 */
export type ActivityEntry = Activity & {
  /** Null when the actor is an agent, or a user who has since been deleted. */
  actorName: string | null;
  actorImage: string | null;
};
