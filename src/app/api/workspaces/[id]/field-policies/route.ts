import { fieldPolicies, removeFieldPolicy, saveFieldPolicy } from "@/features/admin/server/handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return fieldPolicies(request, id); }
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return saveFieldPolicy(request, id); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return removeFieldPolicy(request, id); }
