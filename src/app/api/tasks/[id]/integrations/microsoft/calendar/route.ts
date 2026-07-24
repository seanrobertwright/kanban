import { syncMicrosoftTaskCalendar } from "@/features/integrations/server/task-handlers";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return syncMicrosoftTaskCalendar(request, Number(id)); }
