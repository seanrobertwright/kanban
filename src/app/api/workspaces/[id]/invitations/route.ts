import { handleInvite } from "@/features/workspaces/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleInvite(request, id);
}
