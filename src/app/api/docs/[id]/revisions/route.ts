import { handleListDocRevisions } from "@/features/docs/server/handlers";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleListDocRevisions(request, (await params).id); }
