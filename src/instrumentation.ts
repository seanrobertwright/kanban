/**
 * Next's server-startup seam (instrumentation.js): register() runs once when a
 * server instance boots, before it serves a request. We use it to start the
 * durable run-queue drainer (drainer.ts) — the worker that re-dispatches agent
 * runs that after() stranded on a crashed or redeployed process (013, §7.1).
 *
 * Guarded to the Node.js runtime: the Edge runtime has no pg and runs no agent
 * loop, and register() is also invoked there. The drainer module is imported
 * dynamically so next/edge builds never pull pg / the Anthropic SDK into their
 * graph — the import only happens on the one runtime that can act on it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startRunDrainer } = await import(
    "@/features/agents/server/drainer"
  );
  startRunDrainer();
}
