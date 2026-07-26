import { handleReviewTimesheet } from "@/features/time/server/handlers";

export const dynamic = "force-dynamic";

/**
 * `POST /api/board/:id/timesheet/approvals` — submit or review a week (083).
 * The verdicts themselves are read as part of the timesheet one level up, since
 * they only mean anything beside the grid they annotate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleReviewTimesheet(request, id);
}
