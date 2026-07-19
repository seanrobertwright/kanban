import { handleDeleteAttachment } from "@/features/attachments/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteAttachment(request, Number(id));
}
