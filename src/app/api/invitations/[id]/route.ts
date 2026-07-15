import { handleRevokeInvitation } from "@/features/workspaces/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleRevokeInvitation(request, id);
}
