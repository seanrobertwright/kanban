import { withDryRun } from "@/shared/db/with-dry-run";
import { withIdempotency } from "@/shared/db/idempotency";
import {
  handleCreateComment,
  handleListComments,
} from "@/features/comments/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListComments(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // A duplicated comment is the most visible double-write there is — it lands in
  // the thread a human reads. Idempotency-Key (093) makes the retry safe.
  return withDryRun(request, () =>
    withIdempotency(request, () => handleCreateComment(request, id))
  );
}
