import { handleDeleteSavedView } from "@/features/views/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteSavedView(request, Number(id));
}
