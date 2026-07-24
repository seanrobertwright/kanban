import { notFound } from "next/navigation";
import { RichText } from "@/shared/ui/rich-text";
import { getPublicDoc } from "@/features/docs/server/repository";

export default async function PublicDoc({ params }: { params: Promise<{ token: string }> }) {
  let doc: Awaited<ReturnType<typeof getPublicDoc>> | null = null;
  try { doc = await getPublicDoc((await params).token); } catch { /* capability is intentionally opaque */ }
  if (!doc) notFound();
  return <main className="mx-auto w-full max-w-3xl p-8"><h1 className="mb-6 text-3xl font-semibold">{doc.title}</h1><RichText text={doc.body} /></main>;
}
