import { handleScaledAgile } from "@/features/teams/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleScaledAgile(request, id);
}
