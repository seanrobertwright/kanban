import { handleCreateFeedback } from "@/features/discovery/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateFeedback(request, id);
}
