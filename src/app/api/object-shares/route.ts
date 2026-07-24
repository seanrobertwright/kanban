import { grant,ungrant } from "@/features/sharing/server/handlers";
export async function POST(request:Request){return grant(request);}
export async function DELETE(request:Request){return ungrant(request);}
