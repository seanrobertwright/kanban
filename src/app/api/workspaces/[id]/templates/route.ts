import {
  handleCreateTemplate,
  handleListTemplates,
} from "@/features/templates/server/handlers";

// Under the workspace, like labels and views: 019 scopes templates to the
// workspace, and the path says so.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListTemplates(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateTemplate(request, id);
}
