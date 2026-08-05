import { withDryRun } from "@/shared/db/with-dry-run";
import {
  handleDeleteChecklistItem,
  handleUpdateChecklistItem,
} from "@/features/checklists/server/handlers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleUpdateChecklistItem(request, Number(id)));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handleDeleteChecklistItem(request, Number(id)));
}
