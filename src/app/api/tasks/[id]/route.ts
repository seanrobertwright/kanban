import { withDryRun } from "@/shared/db/with-dry-run";
import {
  handleDeleteTask,
  handleGetTask,
  handleUpdateTask,
} from "@/features/tasks/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGetTask(request, Number(id));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleUpdateTask(request, Number(id)));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Wrapped although no agent tool deletes: an unwrapped mutating route would
  // ignore the header and delete for real, which is the one answer a caller
  // asking "what would this do?" must never get.
  return withDryRun(request, () => handleDeleteTask(request, Number(id)));
}
