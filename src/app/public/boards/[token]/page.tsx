import { notFound } from "next/navigation";
import { getPublicBoard } from "@/features/sharing/server/repository";

export default async function PublicBoard({ params }: { params: Promise<{ token: string }> }) {
  let board: Awaited<ReturnType<typeof getPublicBoard>> | null = null;
  try { board = await getPublicBoard((await params).token); } catch { /* capability is intentionally opaque */ }
  if (!board) notFound();
  return <main className="mx-auto max-w-6xl p-8"><h1 className="mb-6 text-3xl font-semibold">{board.name}</h1><div className="flex gap-4 overflow-x-auto">{board.columns.map((column) => <section key={column.id} className="w-72 shrink-0 rounded border bg-muted/30 p-3"><h2 className="mb-3 font-medium">{column.title}</h2><div className="grid gap-2">{board.tasks.filter((task) => task.columnId === column.id).map((task) => <article key={task.id} className="rounded bg-background p-3 shadow-sm"><h3 className="font-medium">{task.title}</h3>{task.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{task.description}</p>}</article>)}</div></section>)}</div></main>;
}
