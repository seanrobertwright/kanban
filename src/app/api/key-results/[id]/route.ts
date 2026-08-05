import { withDryRun } from "@/shared/db/with-dry-run";
import {
  handleDeleteKeyResult,
  handleUpdateKeyResult,
} from "@/features/objectives/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleUpdateKeyResult(request, id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleDeleteKeyResult(request, id));
}
