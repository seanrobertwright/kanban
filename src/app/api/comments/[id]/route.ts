import {
  handleDeleteComment,
  handleUpdateComment,
} from "@/features/comments/server/handlers";

// Comments are addressed by their own id here rather than nested under the task,
// following /api/tasks/[id] and /api/invitations/[id]: the task in the path
// would be decoration, since the comment id already resolves it — and a route
// that accepts both would have to decide what to do when they disagree.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUpdateComment(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDeleteComment(request, id);
}
