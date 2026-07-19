import {
  handleGetBudget,
  handleSetBudget,
} from "@/features/agents/server/handlers";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGetBudget(request, id);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSetBudget(request, id);
}
