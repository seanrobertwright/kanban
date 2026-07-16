import {
  handleClaimTask,
  handleReleaseTask,
} from "@/features/tasks/server/handlers";

/**
 * The claim is a sub-resource of the task: POST takes it, DELETE drops it. A
 * claim is a thing that exists or does not, so create/remove maps onto it more
 * honestly than a verb on the task would — and it keeps the exclusive-hold
 * mutation off the PATCH path, where a claim could otherwise ride along with an
 * unrelated field edit and blur which action a reviewer is approving at M2.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleClaimTask(request, Number(id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleReleaseTask(request, Number(id));
}
