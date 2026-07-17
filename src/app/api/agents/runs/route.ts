import {
  handleLatestRunForTask,
  handleStartRun,
} from "@/features/agents/server/handlers";

export const dynamic = "force-dynamic";

/** GET /api/agents/runs?taskId=N — the latest run for a task, for the dialog. */
export async function GET(request: Request) {
  return handleLatestRunForTask(request);
}

/**
 * POST /api/agents/runs — start a run for a task already assigned to a native
 * agent (a re-run, or the manual entry point for testing the loop). The
 * automatic path is assigning the task to the agent, which enqueues a run inside
 * the assignment itself (updateTask); this is the on-demand door onto the same
 * executeRun.
 */
export async function POST(request: Request) {
  return handleStartRun(request);
}
