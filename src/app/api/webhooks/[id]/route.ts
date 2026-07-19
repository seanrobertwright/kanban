import { handleDeleteWebhook } from "@/features/webhooks/server/handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteWebhook(request, id);
}
