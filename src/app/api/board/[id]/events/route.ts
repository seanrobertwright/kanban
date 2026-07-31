import { handleBoardEvents } from "@/features/activity/server/handlers";

// A long poll holds the request open for up to MAX_WAIT_SECONDS, so this route
// must not be statically evaluated or cached: every call is a distinct point in
// a stream, and a cached body would answer with someone else's cursor.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleBoardEvents(request, id);
}
