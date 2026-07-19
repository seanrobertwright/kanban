import {
  handleListAttachments,
  handleUploadAttachment,
} from "@/features/attachments/server/handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListAttachments(request, Number(id));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUploadAttachment(request, Number(id));
}
