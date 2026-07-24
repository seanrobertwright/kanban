import { revoke } from "@/features/sharing/server/handlers";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){return revoke(request,(await params).id);}
