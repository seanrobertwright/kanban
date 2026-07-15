import {
  handleRemoveMember,
  handleUpdateMember,
} from "@/features/workspaces/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return handleUpdateMember(request, id, userId);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return handleRemoveMember(request, id, userId);
}
