import { summary } from "@/features/admin/server/handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return summary(request, id); }
