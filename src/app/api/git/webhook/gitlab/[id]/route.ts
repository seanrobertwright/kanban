import { handleGitlabWebhook } from "@/features/git/server/handlers";

// GitLab webhook ingress (2.2). The [id] is the repo_connection id GitLab was
// configured to POST to; the X-Gitlab-Token header is verified against that
// connection's secret. No session — the token is the credential.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGitlabWebhook(request, id);
}
