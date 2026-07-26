import { notFound } from "next/navigation";
import { getPublicForm } from "@/features/sharing/server/repository";
import { PublicForm } from "@/features/forms/components/public-form";

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let form: Awaited<ReturnType<typeof getPublicForm>> | null = null;
  try { form = await getPublicForm(token); } catch { /* capability is intentionally opaque */ }
  if (!form) notFound();
  return <main className="mx-auto w-full max-w-xl p-8"><h1 className="mb-1 text-3xl font-semibold">{form.name}</h1>{form.description && <p className="mb-6 text-sm text-muted-foreground">{form.description}</p>}{form.isOpen ? <PublicForm token={token} fields={form.fields} /> : <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">This form is currently closed to submissions.</p>}</main>;
}
