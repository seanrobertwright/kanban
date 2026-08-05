import { withDryRun } from "@/shared/db/with-dry-run";
import { handlePromoteIdea } from "@/features/discovery/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withDryRun(request, () => handlePromoteIdea(request, id));
}
