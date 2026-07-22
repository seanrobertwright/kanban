import { handleGraphQL } from "@/features/graphql/server/handlers";

// GraphQL API (2.9) — a read-first surface beside REST, over the same repositories
// and the same principal auth (session cookie or x-agent-key). POST { query, variables }.
export async function POST(request: Request) {
  return handleGraphQL(request);
}
