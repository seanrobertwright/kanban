import { deleteIntegration } from "@/features/integrations/server/handlers";

export const dynamic = "force-dynamic";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; connectionId: string }> }) { const { id, connectionId } = await params; return deleteIntegration(request, id, connectionId); }
