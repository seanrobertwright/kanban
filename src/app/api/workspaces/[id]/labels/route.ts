import {
  handleCreateLabel,
  handleListLabels,
} from "@/features/labels/server/handlers";

// Under the workspace, not a board: 007 scopes the vocabulary to the workspace,
// and the path says so. This is the one collection whose owner is not a board.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListLabels(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateLabel(request, id);
}
