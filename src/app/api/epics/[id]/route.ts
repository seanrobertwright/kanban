import { withDryRun } from "@/shared/db/with-dry-run";
import {
  handleDeleteEpic,
  handleUpdateEpic,
} from "@/features/epics/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleUpdateEpic(request, id));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleDeleteEpic(request, id));
}
