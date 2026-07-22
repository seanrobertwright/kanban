import {
  handleCreateWorkflowTemplate,
  handleListWorkflowTemplates,
} from "@/features/automations/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListWorkflowTemplates(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateWorkflowTemplate(request, id);
}
