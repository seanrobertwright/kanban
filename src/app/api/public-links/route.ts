import { listLinks,mint } from "@/features/sharing/server/handlers";
export async function GET(request:Request){return listLinks(request);}
export async function POST(request:Request){return mint(request);}
