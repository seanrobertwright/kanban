import { grantBoard, listGrants } from "@/features/admin/server/handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return listGrants(request, id); }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return grantBoard(request, id); }
