import { handleListAssignees } from "@/features/agents/server/handlers";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/:id/assignees — the email-free assignment roster (people +
 * agents) an agent reads to hand a task to someone. Distinct from
 * /api/workspaces/:id/members, which is human-only and carries email addresses.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListAssignees(request, id);
}
