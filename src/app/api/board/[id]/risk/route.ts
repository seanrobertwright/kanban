import { handleBoardRisks } from "@/features/board/server/handlers";

// Delivery risk for a board (4.2) — the scored, explained subset of the
// analytics payload, on its own cheap door. Read-only, viewer-gated.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleBoardRisks(request, id);
}
