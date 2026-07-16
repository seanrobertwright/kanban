import { handleCreateColumn } from "@/features/board/server/handlers";

// Nested under the board, which is what a new column needs in order to exist.
// Reading them is not here: columns arrive with the board from GET /api/board/:id,
// and a second endpoint returning the same rows would be a second thing to keep
// in step with the first.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateColumn(request, id);
}
