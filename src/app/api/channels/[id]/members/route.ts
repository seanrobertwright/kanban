import { addMember, members } from "@/features/chat/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return members(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return addMember(request,(await params).id);}
