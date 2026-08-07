import type { AgentActionView } from "../types";

/** One agent action as a human-readable line — shared by the task dialog's
 *  review panel and the Agents dialog's held-for-review queue. */
export function describeAction(a: AgentActionView): string {
  const i = (a.input ?? {}) as Record<string, unknown>;
  switch (a.tool) {
    case "set_priority":
      return `Set priority to ${i.priority}`;
    case "set_due_date":
      return i.dueDate ? `Set due date to ${i.dueDate}` : "Cleared the due date";
    case "set_labels":
      return "Set labels";
    case "rename_task":
      return "Edited the title/description";
    case "comment_on_task":
      return "Commented";
    case "claim_task":
      return "Claimed the task";
    case "release_task":
      return "Released the task";
    case "move_task":
      return `Move to column ${i.columnId}`;
    case "assign_task": {
      const who = i.assignee as { type: string; id: string } | null;
      return who ? `Assign to ${who.type} ${who.id}` : "Unassign";
    }
    case "create_task":
      return `Create task "${i.title}"`;
    case "create_subtask":
      return `Create subtask "${i.title}"`;
    default:
      return a.tool;
  }
}
