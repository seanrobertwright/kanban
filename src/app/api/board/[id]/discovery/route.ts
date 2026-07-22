import { handleListDiscovery } from "@/features/discovery/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListDiscovery(request, id);
}
