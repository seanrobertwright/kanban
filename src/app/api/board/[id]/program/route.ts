import { handleAssignBoardProgram } from "@/features/programs/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleAssignBoardProgram(request, id);
}
