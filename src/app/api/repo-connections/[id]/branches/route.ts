import { handleListRepoBranches } from "@/features/git/server/handlers";

// Repository branch list (2.10) — read-through to the provider's branches API.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListRepoBranches(request, id);
}
