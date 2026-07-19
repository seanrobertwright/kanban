import { handleMarkNotificationsSeen } from "@/features/activity/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleMarkNotificationsSeen(request, id);
}
