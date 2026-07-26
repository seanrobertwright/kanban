import { removeMember } from "@/features/chat/server/handlers";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;userId:string}>}){const p=await params;return removeMember(request,p.id,p.userId);}
