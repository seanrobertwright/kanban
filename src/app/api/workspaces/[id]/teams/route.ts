import { handleCreateTeam } from "@/features/teams/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateTeam(request, id);
}
