import { handleCreateTask } from "@/features/tasks/server/handlers";

export async function POST(request: Request) {
  return handleCreateTask(request);
}
