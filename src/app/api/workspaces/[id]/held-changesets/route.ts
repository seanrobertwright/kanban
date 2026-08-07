import { handleListHeldRuns } from "@/features/agents/server/handlers";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListHeldRuns(request, id);
}
