import {
  handleCreateSavedView,
  handleListSavedViews,
} from "@/features/views/server/handlers";

// Under the workspace: a saved view is scoped to (workspace, user), and the
// path names the workspace half. The user half is the session, not the URL —
// you only ever list or create your own.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListSavedViews(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateSavedView(request, id);
}
