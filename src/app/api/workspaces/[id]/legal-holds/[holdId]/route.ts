import { releaseHold } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;holdId:string}>}){const {id,holdId}=await params;return releaseHold(request,id,holdId);}
