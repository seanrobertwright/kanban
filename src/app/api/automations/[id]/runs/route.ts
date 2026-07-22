import { handleListAutomationRuns } from "@/features/automations/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListAutomationRuns(request, id);
}
