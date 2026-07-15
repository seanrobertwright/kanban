import { handleCreateWorkspace } from "@/features/workspaces/server/handlers";

export async function POST(request: Request) {
  return handleCreateWorkspace(request);
}
