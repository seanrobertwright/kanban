import { handleListTaskGitLinks } from "@/features/git/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListTaskGitLinks(request, id);
}
