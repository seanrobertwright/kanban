import { scimToken } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string;providerId:string}>}){const {id,providerId}=await params;return scimToken(request,id,providerId);}
