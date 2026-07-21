import {
  handleDeleteKeyResult,
  handleUpdateKeyResult,
} from "@/features/objectives/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateKeyResult(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteKeyResult(request, id);
}
