import {
  handleDeleteLabel,
  handleUpdateLabel,
} from "@/features/labels/server/handlers";

// Addressed by their own id, following /api/tasks/[id] and /api/columns/[id]:
// the workspace in the path would be decoration, since the label id resolves it.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateLabel(request, Number(id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteLabel(request, Number(id));
}
