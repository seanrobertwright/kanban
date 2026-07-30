import { handleDeleteTimeOff } from "@/features/capacity/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId } = await params;
  return handleDeleteTimeOff(request, id, entryId);
}
