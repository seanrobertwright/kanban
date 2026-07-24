import { listRetention, saveRetention } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return listRetention(request,id);}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return saveRetention(request,id);}
