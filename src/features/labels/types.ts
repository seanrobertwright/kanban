/**
 * Mirrors the `label_color` enum in 007. A closed set, so an enum in Postgres
 * and a union here — but unlike TaskPriority, the order carries no meaning:
 * nothing sorts by colour, and this array exists only to enumerate the palette
 * for the picker and to validate what arrives at the API.
 */
export type LabelColor =
  | "slate"
  | "red"
  | "amber"
  | "green"
  | "sky"
  | "violet"
  | "pink";

export const LABEL_COLORS: readonly LabelColor[] = [
  "slate",
  "red",
  "amber",
  "green",
  "sky",
  "violet",
  "pink",
] as const;

export function isLabelColor(value: unknown): value is LabelColor {
  return (
    typeof value === "string" && (LABEL_COLORS as readonly string[]).includes(value)
  );
}

/**
 * A label is workspace-scoped, not board-scoped — the one real decision in 007.
 * A workflow belongs to a board; a vocabulary does not.
 */
export interface Label {
  id: number;
  workspaceId: string;
  name: string;
  color: LabelColor;
  createdAt: string;
}

/**
 * A label as everything outside the vocabulary refers to it: enough to name it,
 * and no more.
 *
 * A task carries these rather than bare ids, which is a deliberate break from
 * `assigneeId` and worth the paragraph. That field carries only an id because
 * the picker needs the member list anyway, so the name is a free client-side
 * lookup, and joining it onto every task would repeat the same two strings on
 * every card of the same person.
 *
 * The name has to be here anyway, because of what the *log* needs. A task.labeled
 * row must carry the task's whole label set on either side, and it must stay
 * readable after the label is deleted — task_label CASCADEs, so an id alone goes
 * dangling and the record of a labelling becomes unnameable (ColumnSnapshot's
 * rule). So the choice is not "id or name", it is "carry the name on the row, or
 * fetch it again for every log write". Deleting a label that five hundred tasks
 * wear makes that concrete: one query, or five hundred.
 *
 * The colour is not here, and that is the line. A colour is presentation, it is
 * looked up by id from the vocabulary the picker already holds, and a deleted
 * label's colour is not a fact anyone needs — where its name is the only thing
 * that makes an entry a sentence.
 */
export interface LabelRef {
  id: number;
  name: string;
}

export interface CreateLabelInput {
  name: string;
  color?: LabelColor;
}

export interface UpdateLabelInput {
  /** Absent leaves it alone. Neither field is nullable, so COALESCE expresses both. */
  name?: string;
  color?: LabelColor;
}

/** The longest a label can be and still read as a chip rather than a sentence. */
export const LABEL_NAME_MAX = 32;
