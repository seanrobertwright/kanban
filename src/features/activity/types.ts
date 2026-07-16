import type { LabelRef } from "@/features/labels/types";
import type { TaskPriority } from "@/features/tasks/types";

export type { LabelRef };

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
  | "task.assigned"
  /**
   * 006's two fields get their own actions, which raises the question 004 could
   * dodge — if every field earns an action, the union is just the column list
   * spelled twice. So the line, stated once here and applied from now on:
   *
   *   An action exists when its inverse is something someone would want to
   *   apply on its own.
   *
   * That derives what is already here. Nobody reverts a title edit but keeps the
   * description edit from the same submit — they are one authored change, so
   * task.updated covers both. But reverting a reassignment while keeping a
   * rename is an ordinary want, which is why task.assigned split off.
   *
   * Priority passes the test twice over, and the second time decides it the way
   * the agent trigger decided task.assigned. M2's changeset review (§7.4) shows
   * an agent's proposed actions as one diff to accept or reject *in parts* — and
   * criterion #1 is an agent triaging twenty bugs, where "set priority to
   * Urgent" is exactly the unit a reviewer accepts or rejects. Folded into
   * task.updated it would not be separable from the description edit beside it.
   * At M5 it becomes a trigger outright: "when a bug is labeled P0, assign to
   * the triage agent" reads priority to decide.
   *
   * Covers set, raise, lower, and clear — all four are "the priority changed",
   * and since 'none' is a value rather than null, clearing is not a special case
   * the way unassigning is.
   */
  | "task.prioritized"
  /**
   * The due date passes the same test on the first clause alone, and it is worth
   * being honest that its case is thinner than priority's: no milestone makes a
   * due date a trigger. What carries it is that a date is a *commitment* rather
   * than content — M3's calendar view and M4's sprint planning both read it as a
   * scheduling signal, not a description — and that "moved the due date to
   * Friday" is an event a reader scans a history for, while "updated this task"
   * is what they scroll past.
   *
   * Named for the act, not the field, following task.assigned. Covers setting,
   * moving, and clearing a date.
   */
  | "task.scheduled"
  /**
   * Passes 006's test on the same clause priority does, and for the same reason:
   * M2's criterion #1 has an agent *label* twenty bugs, and the changeset review
   * accepts or rejects "added p0" as a unit. At M5 it is a trigger outright —
   * "when a bug is labeled P0, assign to the triage agent" is the PRD's own
   * example, and it reads this action by name.
   *
   * One row per task per change of the set, covering adds and removes together:
   * `before` and `after` carry the whole label set on either side, so a row says
   * what the task's labels were and became rather than naming a delta. That
   * matches every other task action — `action` says what the entry is *about*,
   * the snapshots say what the task looked like — and it means undo restores a
   * set rather than replaying a sequence of adds and removes that could
   * interleave with someone else's.
   */
  | "task.labeled";

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

/**
 * The vocabulary itself changing, as distinct from a task's use of it — the same
 * split ColumnAction draws, and these rows behave the same way: a null `taskId`,
 * because the subject is the label, and a null `boardId` too, because a label is
 * workspace-scoped and belongs to no board (007). Nothing renders them yet; they
 * are written because the M1 criterion is that *every* mutation writes a row,
 * and because a workspace feed built later cannot be backfilled onto an
 * append-only table (003).
 *
 * Renaming a label is deliberately not a task mutation, though it changes what
 * every card says. The tasks did not change — the vocabulary did — and logging
 * five hundred task.labeled rows for one rename would bury the actual event
 * under bookkeeping, which is the reasoning task.moved already applies to the
 * siblings it shifts.
 */
export type LabelAction = "label.created" | "label.updated" | "label.deleted";

export type ActivityAction =
  | TaskAction
  | CommentAction
  | ColumnAction
  | LabelAction;

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
  /**
   * Optional for 004's reason, one milestone later: rows written before 006 have
   * no such key. Note it is never *null* — the column is NOT NULL DEFAULT 'none'
   * — so `undefined` here means only "written before priorities existed", and
   * carries none of assigneeId's ambiguity.
   *
   * The table itself was backfilled to 'none', truthfully; the log cannot be,
   * for the reason 003 gives. A snapshot is what the task looked like at an
   * instant, and at that instant it had no priority to look like.
   */
  priority?: TaskPriority;
  /**
   * Optional for the same reason, and three-valued for the same reason as
   * assigneeId: `undefined` means "written before 006", `null` means "had no due
   * date". 'YYYY-MM-DD' when set — never a Date, in the log least of all, where
   * it would be frozen into JSONB as a UTC instant and be wrong forever.
   */
  dueDate?: string | null;
  /**
   * The task's whole label set at this instant — not a delta.
   *
   * Optional for 003's reason (pre-007 rows have no key) and, like priority,
   * never null: a task with no labels has `[]`. That is the same fact that makes
   * `labelIds` two-valued on update, one layer down — a set has an empty value,
   * so nothing here needs to mean "cleared" separately from "empty".
   *
   * Carries names, where `assigneeId` carries only an id, and the two rules
   * genuinely point opposite ways here. A user row outlives their membership, so
   * the feed can resolve a name for someone who has left. A label row does not
   * outlive its deletion — task_label CASCADEs and the vocabulary entry is gone —
   * so an id alone would make the record of a labelling unreadable the moment
   * someone tidies up the label list. This is ColumnSnapshot.title's reasoning
   * exactly, reached again one migration later. See LabelRef.
   */
  labels?: LabelRef[];
}

/**
 * What a label looked like at one instant. Carries its own id for the reason
 * CommentSnapshot and ColumnSnapshot do — the row's task_id is null here, so
 * nothing else identifies the subject.
 */
export interface LabelSnapshot {
  labelId: number;
  name: string;
  color: string;
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

export type Snapshot =
  | TaskSnapshot
  | CommentSnapshot
  | ColumnSnapshot
  | LabelSnapshot;

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

export interface LabelActivity extends ActivityBase {
  action: LabelAction;
  before: LabelSnapshot | null;
  after: LabelSnapshot | null;
}

export type Activity =
  | TaskActivity
  | CommentActivity
  | ColumnActivity
  | LabelActivity;

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
