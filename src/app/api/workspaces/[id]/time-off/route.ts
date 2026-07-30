import { handleCreateTimeOff } from "@/features/capacity/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateTimeOff(request, id);
}
