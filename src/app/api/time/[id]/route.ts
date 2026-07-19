import { handleDeleteTimeEntry } from "@/features/time/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteTimeEntry(request, id);
}
