import { revokeGrant } from "@/features/admin/server/handlers";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; grantId: string }> }) { const { id, grantId } = await params; return revokeGrant(request, id, grantId); }
