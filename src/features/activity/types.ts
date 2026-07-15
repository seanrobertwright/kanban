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
  | "task.deleted";

/** What a task looked like at one instant. `before`/`after` hold these. */
export interface TaskSnapshot {
  title: string;
  description: string;
  columnId: number;
  position: number;
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
