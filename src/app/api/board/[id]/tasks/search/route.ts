import { handleSearchTasks } from "@/features/tasks/server/handlers";

export const dynamic = "force-dynamic";

/**
 * `GET /api/board/:id/tasks/search?q=…` — the app's first search of any kind.
 *
 * Nested under the board rather than sitting at `/api/tasks/search`, because
 * the authorization is a board-level check and the route should say so: there
 * is no cross-board search here, and a path that implied one would be a promise
 * the handler does not keep.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSearchTasks(request, Number(id));
}
