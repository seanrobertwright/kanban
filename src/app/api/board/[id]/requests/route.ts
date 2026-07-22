import { handleListRequests } from "@/features/requests/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListRequests(request, id);
}
