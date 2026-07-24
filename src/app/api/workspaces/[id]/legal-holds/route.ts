import { hold, holds } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return hold(request,id);}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return holds(request,id);}
