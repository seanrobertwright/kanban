import { handleDeleteWorkflowTemplate } from "@/features/automations/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteWorkflowTemplate(request, id);
}
