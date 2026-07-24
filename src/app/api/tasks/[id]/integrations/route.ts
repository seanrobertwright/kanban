import { listTaskLinks } from "@/features/integrations/server/task-handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return listTaskLinks(request, Number(id)); }
