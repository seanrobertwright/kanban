import { handleSubmitForm } from "@/features/forms/server/handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSubmitForm(request, id);
}
