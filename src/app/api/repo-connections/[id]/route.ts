import { handleDeleteConnection } from "@/features/git/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteConnection(request, id);
}
