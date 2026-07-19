import {
  handleCreateChecklistItem,
  handleListChecklist,
} from "@/features/checklists/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListChecklist(request, Number(id));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleCreateChecklistItem(request, Number(id));
}
