import { withIdempotency } from "@/shared/db/idempotency";
import { handleCreateTask } from "@/features/tasks/server/handlers";

// Creates take an optional Idempotency-Key (093), which is what lets a client
// retry a POST whose answer it never saw. Without the header this is exactly the
// route it was before.
export async function POST(request: Request) {
  return withIdempotency(request, () => handleCreateTask(request));
}
