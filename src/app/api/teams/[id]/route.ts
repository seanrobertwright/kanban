import {
  handleDeleteTeam,
  handleUpdateTeam,
} from "@/features/teams/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateTeam(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteTeam(request, id);
}
