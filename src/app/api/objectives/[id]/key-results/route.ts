import { handleCreateKeyResult } from "@/features/objectives/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateKeyResult(request, id);
}
