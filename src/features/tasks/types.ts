export interface Task {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  /**
   * The member this task is assigned to, or null. Peer to the `agentId` that
   * lands at M2 (PRD §8) — the picker treats agents as another kind of
   * assignee rather than a separate concept, which is the wedge in one field.
   *
   * Only the id: the name and avatar are resolved client-side from the member
   * list the assignee picker already needs, rather than joined onto every task
   * in getBoard. Widening the read to carry display data would put the same
   * two strings on every card of the same person.
   */
  assigneeId: string | null;
  createdAt: string;
}

export interface CreateTaskInput {
  columnId: number;
  title: string;
  description?: string;
  assigneeId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  /**
   * Three-valued, and the distinction is load-bearing: `undefined` means "leave
   * the assignee alone", `null` means "unassign". The existing COALESCE idiom in
   * updateTask cannot express this — it reads null as "no value supplied" — so
   * the repository tests for the key's presence instead. Harmless for title and
   * description, neither of which is nullable; fatal here, where clearing the
   * field IS one of the two things a user wants to do.
   */
  assigneeId?: string | null;
}

export interface MoveTaskInput {
  columnId: number;
  position: number;
}
