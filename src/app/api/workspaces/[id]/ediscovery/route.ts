import { discover, exportDiscover } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return discover(request,id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return exportDiscover(request,id);}
