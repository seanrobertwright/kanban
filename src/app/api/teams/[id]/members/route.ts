import {
  handleAddTeamMember,
  handleRemoveTeamMember,
} from "@/features/teams/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleAddTeamMember(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleRemoveTeamMember(request, id);
}
