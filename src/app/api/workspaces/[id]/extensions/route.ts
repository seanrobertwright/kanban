import { installExtension, listExtensions } from "@/features/extensions/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return listExtensions(request,id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return installExtension(request,id);}
