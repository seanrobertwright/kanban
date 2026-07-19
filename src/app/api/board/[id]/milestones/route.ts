import {
  handleCreateMilestone,
  handleListMilestones,
} from "@/features/milestones/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListMilestones(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateMilestone(request, id);
}
