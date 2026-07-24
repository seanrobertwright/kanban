import { handleKnowledgeQuery } from "@/features/knowledge/server/handlers";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleKnowledgeQuery(request, (await params).id);
}
