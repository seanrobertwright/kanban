import { handleSetMemberCapacity } from "@/features/capacity/server/handlers";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return handleSetMemberCapacity(request, id, userId);
}
