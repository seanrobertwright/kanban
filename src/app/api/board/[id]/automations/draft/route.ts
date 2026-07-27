import { handleDraftAutomation } from "@/features/automations/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDraftAutomation(request, id);
}
