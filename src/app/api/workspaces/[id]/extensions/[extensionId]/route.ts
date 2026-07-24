import { deleteExtension } from "@/features/extensions/server/handlers";
export const dynamic="force-dynamic";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;extensionId:string}>}){const {id,extensionId}=await params;return deleteExtension(request,id,extensionId);}
