import { handleCreateDoc, handleListDocs } from "@/features/docs/server/handlers";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleListDocs(request, (await params).id); }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleCreateDoc(request, (await params).id); }
