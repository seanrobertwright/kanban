import { handleTaskRisk } from "@/features/board/server/handlers";

// One task's delivery risk (4.2), or null when nothing is firing. The board-wide
// answer lives at /api/board/[id]/risk; this is the per-card question the task
// dialog and an agent looking at a single task both ask.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTaskRisk(request, id);
}
