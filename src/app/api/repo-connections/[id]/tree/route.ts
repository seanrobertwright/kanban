import { handleBrowseRepoTree } from "@/features/git/server/handlers";

// Repository file/dir listing (2.10) — read-through to the provider's contents API.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleBrowseRepoTree(request, id);
}
