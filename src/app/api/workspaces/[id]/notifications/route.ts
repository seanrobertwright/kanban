import { handleListNotifications } from "@/features/activity/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListNotifications(request, id);
}
