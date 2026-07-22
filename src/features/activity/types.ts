import type { LabelRef } from "@/features/labels/types";
import type { TaskPriority, TaskType } from "@/features/tasks/types";

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
   * The exclusive working hold an actor takes on a task and later drops (010,
   * PRD §4.3). Two actions rather than one task.updated, and 006's test decides
   * it outright: an action exists when its inverse is something someone would
   * want to apply on its own, and the inverse of a claim IS a release — the two
   * are each other's undo, so they cannot be folded into a single event whose
   * before/after diff a reader has to read to tell which happened.
   *
   * They are also §7.4's auto-tier in the flesh: claiming is listed there among
   * the "cheap, internally reversible, externally silent" actions that execute
   * with no interrupt and an undo window. A claim touches nothing outside the
   * board and is reversed by a release, which is exactly the property that tier
   * requires — so these are the first two actions built already knowing which
   * approval tier they will sit in at M2's gate.
   *
   * task.claimed carries before (claimedBy null) and after (claimedBy the actor);
   * task.released the reverse. The actor and the holder usually coincide, but not
   * always: an admin may release a claim someone else left stuck (a crashed
   * agent), and then the row's actor_id and before.claimedBy differ — which is
   * why the holder is recorded in the snapshot and not inferred from the actor,
   * the same reasoning CommentSnapshot.author reached for comment.deleted.
   */
  | "task.claimed"
  | "task.released"
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
  | "comment.deleted"
  /**
   * Thread housekeeping (024). Two actions rather than one with a flag,
   * because each is its own event a reader scans for, and each inverts to the
   * other — 006's test, passed the same way claimed/released pass it.
   */
  | "comment.resolved"
  | "comment.reopened";

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

/**
 * Milestone lifecycle (026) — column-shaped entries (taskId null, boardId
 * locates), and the same three verbs for the same reasons.
 */
export type MilestoneAction =
  | "milestone.created"
  | "milestone.updated"
  | "milestone.deleted";

/**
 * Release lifecycle (2.8) — milestone-shaped (taskId null, boardId set). `released`
 * is the one that carries weight: it is logged when a release ships, whether a
 * human cut it or a git tag published it, so it rides the automation sink like any
 * other event ("when a release ships, comment on its tasks" is a possible rule).
 */
export type ReleaseAction =
  | "release.created"
  | "release.updated"
  | "release.released"
  | "release.deleted";

/**
 * Epic lifecycle (031) — column-shaped entries (taskId null, boardId locates),
 * milestone's three verbs for milestone's reasons.
 */
export type EpicAction =
  | "epic.created"
  | "epic.updated"
  | "epic.deleted";

/**
 * Objective lifecycle (037) — board-scoped entries (taskId null, boardId
 * locates), epic's three verbs for epic's reasons. Key-result edits are not
 * logged separately: a KR's current value is read live and nudged often, so the
 * feed tracks the objective's own fields, not every measurement.
 */
export type ObjectiveAction =
  | "objective.created"
  | "objective.updated"
  | "objective.deleted";

/**
 * The time ledger (027). Logged and deleted, never edited — a wrong entry is
 * retracted and re-logged, which keeps each row one attributable fact.
 */
export type TimeAction = "time.logged" | "time.deleted";

/**
 * Sprint lifecycle (028) — board-scoped entries (taskId null, boardId locates),
 * milestone's shape. started/completed earn their own actions beside
 * created/updated/deleted because they are the lifecycle events a reader scans
 * for — the same call comment.resolved/reopened made.
 */
export type SprintAction =
  | "sprint.created"
  | "sprint.updated"
  | "sprint.started"
  | "sprint.completed"
  | "sprint.deleted";

/**
 * A task's answer to a custom field changed (035 → 036 follow-up). One action
 * covering set, changed, and cleared — task.prioritized's shape, and for its
 * reason: all three are "the value changed", and before/after say which. A
 * task-shaped entry (taskId set, boardId locates), because a custom-field value
 * lives on a task the way a priority does.
 *
 * 035 deliberately left value edits out of the log — TaskSnapshot is a fixed
 * shape and cannot hold a per-board set of dynamic fields. The answer is not to
 * widen TaskSnapshot but to give the value its own snapshot family, which is
 * what CustomFieldValueSnapshot below is: the deferred problem solved the way
 * every other subject the log grew to cover was.
 */
export type CustomFieldValueAction = "customField.valued";

/**
 * Git development events (2.0) — a new *kind* of activity, not a task mutation.
 * A linked branch/PR/commit changing state is worth a feed line, a webhook, and
 * (the leverage) a Phase-1 rule trigger: "when git.pr_merged, move to Done" is an
 * ordinary automation. The family is logged by the git ingress against the task
 * the artifact references, so it rides the same post-commit sink every other
 * action does — see features/git/server/repository.ts.
 *
 * These carry no undo (003's "an action exists when its inverse is a want" test):
 * a merged PR is a fact about the outside world, not a board edit to revert. They
 * exist for the feed, the webhooks, and the automation trigger, not for undo.
 */
export type GitAction =
  | "git.branch_linked"
  | "git.pr_opened"
  | "git.pr_merged"
  | "git.pr_closed"
  | "git.commit_linked"
  // CI/CD runs (2.7): fired on a run's transition to a terminal conclusion, so
  // "when CI fails, notify the assignee" is an ordinary Phase-1 rule.
  | "git.ci_passed"
  | "git.ci_failed";

export type ActivityAction =
  | TaskAction
  | CommentAction
  | ColumnAction
  | LabelAction
  | MilestoneAction
  | ReleaseAction
  | EpicAction
  | ObjectiveAction
  | TimeAction
  | SprintAction
  | CustomFieldValueAction
  | GitAction;

/** What a task looked like at one instant. */
export interface TaskSnapshot {
  title: string;
  description: string;
  columnId: number;
  position: number;
  /**
   * Who the task is assigned to — a person OR an agent (011) — or null if
   * unassigned. An Actor (type + id), unified above the two peer columns
   * assignee_id / agent_id, the same shape 010's claimedBy took and for the same
   * reason: a polymorphic principal reference has to say which table it points at.
   *
   * Optional because the log is append-only and assignment arrived at 004: rows
   * written before it have no such key. `undefined` means "written before
   * assignees existed"; `null` means "was unassigned". Every row written from 011
   * on sets this rather than the legacy field below.
   */
  assignee?: Actor | null;
  /**
   * Pre-011 rows ONLY. Before agents could be assigned, this snapshot stored a
   * bare user-id string here; 011 unified assignment into `assignee` above, and
   * nothing has written it since. But the log is append-only — 003's rule, that a
   * row is never rewritten and history is never lost — so old rows still carry
   * it, and a reader wanting a historical entry's assignee falls back to reading
   * it as a human Actor. Kept in the type precisely so that fallback type-checks
   * rather than reaching through a cast. See assigneeOf() in activity-feed.tsx:
   * `assignee` wins, this is the legacy tail.
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
   * Optional for priority's exact reason, one migration on: rows written before
   * 022 have no such key, and never null — the column is NOT NULL DEFAULT
   * 'task', so `undefined` means only "written before types existed".
   */
  type?: TaskType;
  /**
   * Optional for 003's reason and three-valued like dueDate: `undefined` means
   * "written before 022", `null` means "was unestimated".
   */
  estimate?: number | null;
  /**
   * Optional for 003's reason, one migration on (026): `undefined` means
   * "written before milestones", `null` means "aimed at none".
   */
  milestoneId?: number | null;
  /**
   * Optional for 003's reason (031): `undefined` means "written before epics",
   * `null` means "filed under none".
   */
  epicId?: number | null;
  /**
   * Optional for 003's reason (037): `undefined` means "written before
   * objectives", `null` means "aimed at none".
   */
  objectiveId?: number | null;
  /**
   * Optional for 003's reason (028): `undefined` means "written before
   * sprints", `null` means "was in the backlog".
   */
  sprintId?: number | null;
  /**
   * The scoring inputs (034), optional for 003's reason: `undefined` means
   * "written before scoring", `null` means "was unscored". The score itself is
   * derived and never snapshotted — restoring these restores it.
   */
  value?: number | null;
  risk?: number | null;
  /**
   * Optional for 003's reason (032): `undefined` means "written before start
   * dates", `null` means "had no start date". dueDate's 'YYYY-MM-DD'-not-Date
   * discipline exactly, and JSONB-frozen for the same reason.
   */
  startDate?: string | null;
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
  /**
   * The task this one decomposes, or null if top-level.
   *
   * Optional for 003's reason, one more milestone on: rows written before 008
   * have no such key, and no backfill can invent one. Three-valued like
   * assigneeId and dueDate — `undefined` means "written before subtasks existed",
   * `null` means "was top-level" — but for a different reason than either. Those
   * two could not be backfilled because the answer was unknowable; this one
   * cannot because 008's DEFAULT NULL is only *usually* the truth. Every pre-008
   * task is top-level, so the column's backfill is honest in the way 006's
   * 'none' was — yet a snapshot is what the task looked like at an instant, and
   * at that instant it had no parent to look like. The distinction survives.
   *
   * Recorded even though it never changes, and that is exactly why it is here:
   * `undo` of task.deleted recreates the task from `before`, and a piece restored
   * without its parent is restored to the board as a card that was never there.
   * The one field a snapshot needs least for *diffing* is the one it needs most
   * for replay.
   *
   * No subtaskCount beside it. That is derived from other rows rather than state
   * this task holds, and undoing a parent's deletion restores its pieces, which
   * restores the count without anyone recording it. See Task.subtaskCount.
   */
  parentId?: number | null;
  /**
   * Who holds the exclusive working claim (010), or null if the task is free.
   *
   * Optional for 003's reason, one milestone on again: rows written before 010
   * have no such key, and no backfill can invent one. Three-valued like
   * assigneeId — `undefined` means "written before claiming existed", `null`
   * means "was unclaimed", an Actor means "was held by that principal".
   *
   * An Actor (type + id), not a bare id, where assigneeId carries only an id:
   * a claim's holder is polymorphic — a human or an agent (010) — so the id
   * alone would not say which table it points at, and a reader resolving a name
   * would not know where to look. This is CommentSnapshot.author's shape and its
   * reasoning: the holder is an actor, so it is recorded actor-shaped.
   *
   * No claimed_at beside it. A claim's timestamp is not state undo must restore —
   * re-claiming on undo takes a fresh now(), and the exact prior instant carries
   * no meaning a later reader depends on. What undo needs is *who* held it, which
   * is this. The same subtaskCount/createdAt cut: on the snapshot only what the
   * inverse mutation has to replay.
   */
  claimedBy?: Actor | null;
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
  /**
   * The comment this one replies to (033), or null/undefined for a top-level
   * remark. `undefined` means "written before threading"; null means top-level.
   * Immutable metadata, TaskSnapshot.parentId's twin — undo recreates a deleted
   * reply under the parent it answered, which a body-only snapshot could not.
   */
  parentId?: number | null;
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
  /**
   * The column's WIP limit (023), or null for none. Optional for 003's reason:
   * rows written before 023 have no such key. `undefined` means "written before
   * limits existed"; `null` means "had no limit".
   */
  wipLimit?: number | null;
}

/** What a milestone looked like at one instant (026). */
export interface MilestoneSnapshot {
  milestoneId: number;
  name: string;
  dueDate: string | null;
}

/** What a release looked like at one instant (2.8) — name + where it is in its
 *  planned→released lifecycle. */
export interface ReleaseSnapshot {
  releaseId: number;
  name: string;
  state: string;
}

/** What an epic looked like at one instant (031). Name only — an epic has no
 *  date, so the snapshot mirrors the table's one mutable field. */
export interface EpicSnapshot {
  epicId: number;
  name: string;
}

/** What an objective looked like at one instant (037). Name only, epic's shape:
 *  the description and date are objective data a reader reads live; the log's job
 *  is to name what was created, renamed, or deleted so the entry still reads. */
export interface ObjectiveSnapshot {
  objectiveId: number;
  name: string;
}

/**
 * What a time entry said (027). Carries `by` for CommentSnapshot.author's
 * reason: an admin deleting someone's entry makes actor and author two
 * different people, and the row must say whose minutes vanished.
 */
export interface TimeSnapshot {
  timeEntryId: number;
  minutes: number;
  spentOn: string;
  note: string;
  by: Actor;
}

/** What a sprint looked like at one instant (028). status carries the
 *  lifecycle, so started/completed need no field beyond the snapshot. */
export interface SprintSnapshot {
  sprintId: number;
  name: string;
  status: "planning" | "active" | "completed";
}

/**
 * One task's answer to one custom field at an instant (035 → 036 follow-up). The
 * before/after pair on a customField.valued row carries two of these — the value
 * as it was and as it became — so undo has the string it needs to restore.
 *
 * `fieldName` is recorded, not just `fieldId`, for ColumnSnapshot.title's reason:
 * a field can be deleted (CASCADE takes its values with it), and the feed resolves
 * names against a board that may no longer have the field — so a history entry
 * could never name what was answered unless the name travelled in the snapshot.
 * `value` is the stored TEXT (interpreted by the field's type) or null when the
 * answer was empty — the same three-valued shape the value store itself has.
 */
export interface CustomFieldValueSnapshot {
  fieldId: number;
  fieldName: string;
  value: string | null;
}

/**
 * The git artifact a git.* activity is about, carried alongside the task's own
 * snapshot. Plain string fields (not the git feature's stricter unions) so this
 * low-level module takes no dependency on features/git — the git feature's typed
 * values are structurally assignable in.
 */
export interface GitLinkInfo {
  provider: string;
  kind: string;
  externalId: string;
  url: string;
  state: string | null;
  title: string | null;
}

/**
 * A git event's snapshot: the linked task exactly as a TaskSnapshot (so the
 * automation evaluator reads its fields and effects apply to it, unchanged), plus
 * the `git` artifact that triggered the event. The intersection is what lets one
 * activity both fire a task-shaped rule and narrate "a PR merged" in the feed.
 */
export type GitSnapshot = TaskSnapshot & { git: GitLinkInfo };

export type Snapshot =
  | TaskSnapshot
  | CommentSnapshot
  | ColumnSnapshot
  | LabelSnapshot
  | MilestoneSnapshot
  | ReleaseSnapshot
  | EpicSnapshot
  | ObjectiveSnapshot
  | TimeSnapshot
  | SprintSnapshot
  | CustomFieldValueSnapshot
  | GitSnapshot;

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

export interface MilestoneActivity extends ActivityBase {
  action: MilestoneAction;
  before: MilestoneSnapshot | null;
  after: MilestoneSnapshot | null;
}

export interface ReleaseActivity extends ActivityBase {
  action: ReleaseAction;
  before: ReleaseSnapshot | null;
  after: ReleaseSnapshot | null;
}

export interface EpicActivity extends ActivityBase {
  action: EpicAction;
  before: EpicSnapshot | null;
  after: EpicSnapshot | null;
}

export interface ObjectiveActivity extends ActivityBase {
  action: ObjectiveAction;
  before: ObjectiveSnapshot | null;
  after: ObjectiveSnapshot | null;
}

export interface TimeActivity extends ActivityBase {
  action: TimeAction;
  before: TimeSnapshot | null;
  after: TimeSnapshot | null;
}

export interface SprintActivity extends ActivityBase {
  action: SprintAction;
  before: SprintSnapshot | null;
  after: SprintSnapshot | null;
}

export interface CustomFieldValueActivity extends ActivityBase {
  action: CustomFieldValueAction;
  before: CustomFieldValueSnapshot | null;
  after: CustomFieldValueSnapshot | null;
}

export interface GitActivity extends ActivityBase {
  action: GitAction;
  before: GitSnapshot | null;
  after: GitSnapshot | null;
}

export type Activity =
  | TaskActivity
  | CommentActivity
  | ColumnActivity
  | LabelActivity
  | MilestoneActivity
  | ReleaseActivity
  | EpicActivity
  | ObjectiveActivity
  | TimeActivity
  | SprintActivity
  | CustomFieldValueActivity
  | GitActivity;

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

/**
 * An activity entry as the notification bell shows it: the actor-joined entry
 * plus the title of the task it concerns, so the feed can say what was touched
 * without the reader resolving it. Null for column/label entries (no task) and
 * resolved from the snapshot for a deleted task, whose row is gone but whose
 * `before`/`after` still names it.
 */
export type NotificationEntry = ActivityEntry & {
  taskTitle: string | null;
  /**
   * True when this entry is a comment that @mentions the reader (024) — the
   * bell's "mentioned you on" over the generic verb. Computed per reader at
   * read time; false for every non-comment row.
   */
  mentionedMe: boolean;
};

export interface WorkspaceNotifications {
  items: NotificationEntry[];
  /** Entries newer than the reader's last-seen marker, by someone other than them. */
  unreadCount: number;
  /** The reader's last-seen timestamp, or null if they have never looked. */
  lastSeenAt: string | null;
}
