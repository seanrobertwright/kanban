import { handleDeleteDoc, handleUpdateDoc } from "@/features/docs/server/handlers";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleUpdateDoc(request, (await params).id); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleDeleteDoc(request, (await params).id); }
