import {
  handleDeleteColumn,
  handleUpdateColumn,
} from "@/features/board/server/handlers";

// Addressed by their own id, following /api/tasks/[id] and /api/comments/[id]:
// the board in the path would be decoration, since the column id resolves it.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateColumn(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteColumn(request, id);
}
