import { handleDownloadAttachment } from "@/features/attachments/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleDownloadAttachment(request, Number(id));
}
