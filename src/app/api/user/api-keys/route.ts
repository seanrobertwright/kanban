import {
  handleCreateUserApiKey,
  handleListUserApiKeys,
} from "@/features/auth/server/user-key-handlers";

export async function GET(request: Request) {
  return handleListUserApiKeys(request);
}

export async function POST(request: Request) {
  return handleCreateUserApiKey(request);
}
