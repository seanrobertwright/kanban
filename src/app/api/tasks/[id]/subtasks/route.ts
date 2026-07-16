import { handleListSubtasks } from "@/features/tasks/server/handlers";

/**
 * Read-only, deliberately. A subtask is created through POST /api/tasks with a
 * parentId, because it is a task — the same route, the same validation, the same
 * RBAC. A POST here would be a second way to create one, and at M2 that is a
 * second surface for an agent tool to drift from.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListSubtasks(request, Number(id));
}
