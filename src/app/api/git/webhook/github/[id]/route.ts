import { handleGithubWebhook } from "@/features/git/server/handlers";

// GitHub App webhook ingress (2.1). The [id] is the repo_connection id GitHub was
// configured to POST to; the X-Hub-Signature-256 header is verified against that
// connection's signing secret. No session — the signature is the credential.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGithubWebhook(request, id);
}
