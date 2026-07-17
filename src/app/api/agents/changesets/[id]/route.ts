import { handleReviewChangeset } from "@/features/agents/server/handlers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleReviewChangeset(request, id);
}
