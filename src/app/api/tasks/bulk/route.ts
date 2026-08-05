import { withDryRun } from "@/shared/db/with-dry-run";
import { handleBulkTasks } from "@/features/tasks/server/handlers";

// POST rather than PATCH on /api/tasks: the subject is a set the body names,
// not a resource the URL does, and a delete can ride the same request shape.
//
// Wrapped although the handler refuses to plan: a bulk edit has no single
// before/after to report, and the wrapper is what turns that into a 501 saying
// so rather than a mutation that ignored the header.
export async function POST(request: Request) {
  return withDryRun(request, () => handleBulkTasks(request));
}
