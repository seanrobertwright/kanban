import { handleRunReport } from "@/features/reports/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleRunReport(request, id);
}
