import { withIdempotency } from "@/shared/db/idempotency";
import {
  handleAddDependency,
  handleGetDependencies,
} from "@/features/dependencies/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGetDependencies(request, Number(id));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withIdempotency(request, () => handleAddDependency(request, Number(id)));
}
