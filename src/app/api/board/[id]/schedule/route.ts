import { handleApplyScheduleProposal, handleScheduleProposal } from "@/features/board/server/handlers";
export async function GET(request: Request, { params }: { params: Promise<{id:string}> }) { return handleScheduleProposal(request, (await params).id); }
export async function POST(request: Request, { params }: { params: Promise<{id:string}> }) { return handleApplyScheduleProposal(request, (await params).id); }
