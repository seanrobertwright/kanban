import type { Principal } from "@/features/auth/server/principal";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import { getBoard } from "./repository";
import { updateTask } from "@/features/tasks/server/repository";
import { proposeSchedule, type ScheduleProposal } from "../lib/schedule-proposal";

export async function getScheduleProposal(actor: string | Principal, boardId: number): Promise<ScheduleProposal[]> {
  await requireBoardRole(actor, boardId, "viewer");
  const board = await getBoard(actor, boardId);
  if (!board) return [];
  return proposeSchedule(board.tasks.map(t => ({ id:t.id, title:t.title, estimate:t.estimate, startDate:t.startDate, dueDate:t.dueDate, assigneeId:t.assignee?.type === "human" ? t.assignee.id : null })), board.dependencies);
}

export async function applyScheduleProposal(userId: string, boardId: number, proposals: ScheduleProposal[]) {
  await requireBoardRole(userId, boardId, "member");
  for (const proposal of proposals) await updateTask(userId, proposal.taskId, { startDate: proposal.startDate, dueDate: proposal.dueDate });
}
