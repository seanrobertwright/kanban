import { removeProvider } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;providerId:string}>}){const {id,providerId}=await params;return removeProvider(request,id,providerId);}
