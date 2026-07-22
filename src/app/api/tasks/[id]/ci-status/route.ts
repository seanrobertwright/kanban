import { handleListTaskCiStatuses } from "@/features/git/server/handlers";

// CI/CD run status for a task (2.7) — the Development section's pass/fail chips.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListTaskCiStatuses(request, id);
}
