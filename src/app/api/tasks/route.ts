import { withDryRun } from "@/shared/db/with-dry-run";
import { withIdempotency } from "@/shared/db/idempotency";
import { handleCreateTask } from "@/features/tasks/server/handlers";

// Creates take an optional Idempotency-Key (093), which is what lets a client
// retry a POST whose answer it never saw. Without the header this is exactly the
// route it was before.
//
// Dry-Run wraps outside the key, deliberately: a planned create writes nothing,
// so spending the caller's key on it would make the real create that follows
// replay the plan instead of creating.
export async function POST(request: Request) {
  return withDryRun(request, () =>
    withIdempotency(request, () => handleCreateTask(request))
  );
}
