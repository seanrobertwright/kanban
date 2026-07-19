import { handleDeleteAgent } from "@/features/agents/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params;
  return handleDeleteAgent(request, id, agentId);
}
