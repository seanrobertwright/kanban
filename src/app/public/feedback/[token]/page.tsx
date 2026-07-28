import { notFound } from "next/navigation";
import { getPublicFeedbackPortal } from "@/features/sharing/server/repository";
import { PublicFeedback } from "@/features/discovery/components/public-feedback";

export default async function PublicFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let portal: Awaited<ReturnType<typeof getPublicFeedbackPortal>> | null = null;
  // A revoked, expired, or invented token is a 404 rather than an explanation —
  // the capability is intentionally opaque, exactly as the public form page is.
  try { portal = await getPublicFeedbackPortal(token); } catch { /* opaque on purpose */ }
  if (!portal) notFound();
  return <main className="mx-auto w-full max-w-xl p-8"><h1 className="mb-1 text-3xl font-semibold">Tell us what you think</h1><p className="mb-6 text-sm text-muted-foreground">Your feedback goes straight to the team working on {portal.boardName}.</p><PublicFeedback token={token} /></main>;
}
