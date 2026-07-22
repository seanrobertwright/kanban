import { handleBitbucketWebhook } from "@/features/git/server/handlers";

// Bitbucket webhook ingress (2.3). The [id] is the repo_connection id Bitbucket
// was configured to POST to; the X-Hub-Signature header is verified against that
// connection's secret. No session — the signature is the credential.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleBitbucketWebhook(request, id);
}
