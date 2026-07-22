import { handleAssignBoardTeam } from "@/features/teams/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleAssignBoardTeam(request, id);
}
