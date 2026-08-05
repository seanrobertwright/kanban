import { withDryRun } from "@/shared/db/with-dry-run";
import {
  handleDeleteObjective,
  handleUpdateObjective,
} from "@/features/objectives/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleUpdateObjective(request, id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleDeleteObjective(request, id));
}
