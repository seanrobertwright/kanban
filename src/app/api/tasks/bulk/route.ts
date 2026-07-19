import { handleBulkTasks } from "@/features/tasks/server/handlers";

// POST rather than PATCH on /api/tasks: the subject is a set the body names,
// not a resource the URL does, and a delete can ride the same request shape.
export async function POST(request: Request) {
  return handleBulkTasks(request);
}
