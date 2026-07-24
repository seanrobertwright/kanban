import { removeIp } from "@/features/admin/server/handlers";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) { const { id, entryId } = await params; return removeIp(request, id, entryId); }
