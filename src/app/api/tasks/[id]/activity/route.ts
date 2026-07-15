import { handleListTaskActivity } from "@/features/activity/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListTaskActivity(request, id);
}
