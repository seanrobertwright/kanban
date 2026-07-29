import { handleTriageRequest } from "@/features/requests/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;
  return handleTriageRequest(request, id, taskId);
}
