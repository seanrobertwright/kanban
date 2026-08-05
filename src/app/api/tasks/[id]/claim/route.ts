import { withDryRun } from "@/shared/db/with-dry-run";
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
 *
 * Both are wrapped for Dry-Run and both refuse it: a lease's answer is decided
 * under a row lock at the moment of the write, so there is nothing to project
 * that would still be true when the caller acted on it. The wrapper is here so
 * that refusal is what a dry run gets, rather than a real claim.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleClaimTask(request, Number(id)));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleReleaseTask(request, Number(id)));
}
