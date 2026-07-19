import { handleRemoveDependency } from "@/features/dependencies/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; depId: string }> }
) {
  const { id, depId } = await params;
  return handleRemoveDependency(request, Number(id), Number(depId));
}
