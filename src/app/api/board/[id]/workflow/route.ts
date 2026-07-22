import {
  handleGetWorkflow,
  handleSetWorkflow,
} from "@/features/automations/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGetWorkflow(request, id);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSetWorkflow(request, id);
}
