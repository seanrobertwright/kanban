import {
  handleDeleteTemplate,
  handleUpdateTemplate,
} from "@/features/templates/server/handlers";

// Addressed by their own id, like /api/labels/[id]: the workspace in the path
// would be decoration, since the template id resolves it.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateTemplate(request, Number(id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteTemplate(request, Number(id));
}
