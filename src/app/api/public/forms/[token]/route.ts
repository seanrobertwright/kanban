import { publicForm, publicFormSubmit } from "@/features/sharing/server/handlers";
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) { return publicForm(request, (await params).token); }
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) { return publicFormSubmit(request, (await params).token); }
