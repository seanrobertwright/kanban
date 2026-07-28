import { publicFeedbackPortal, publicFeedbackSubmit } from "@/features/sharing/server/handlers";
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) { return publicFeedbackPortal(request, (await params).token); }
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) { return publicFeedbackSubmit(request, (await params).token); }
