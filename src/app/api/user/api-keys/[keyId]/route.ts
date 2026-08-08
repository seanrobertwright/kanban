import { handleDeleteUserApiKey } from "@/features/auth/server/user-key-handlers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ keyId: string }> }
) {
  const { keyId } = await params;
  return handleDeleteUserApiKey(request, keyId);
}
