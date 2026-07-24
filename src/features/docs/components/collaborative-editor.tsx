"use client";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { useEffect, useRef } from "react";

import { Textarea } from "@/shared/ui/textarea";

/** A plain textarea bound to Y.Text. The document server owns merge/presence;
 * React only owns the initial fallback value, so remote changes never race a
 * render and overwrite a collaborator's keystroke. */
export function CollaborativeEditor({ docId, initialBody, disabled, onChange }: { docId: number; initialBody: string; disabled: boolean; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = ref.current;
    if (disabled || !textarea) return;
    let stopped = false;
    const ydoc = new Y.Doc();
    const text = ydoc.getText("body");
    let provider: WebsocketProvider | undefined;
    const updateDom = () => { const value = text.toString(); if (ref.current && ref.current.value !== value) ref.current.value = value; onChange(value); };
    const onInput = () => { const value = ref.current?.value ?? ""; ydoc.transact(() => { text.delete(0, text.length); text.insert(0, value); }); };
    textarea.value = initialBody;
    textarea.addEventListener("input", onInput);
    text.observe(updateDom);
    void fetch(`/api/docs/${docId}/collaboration-ticket`, { method: "POST" }).then(async (response) => {
      if (!response.ok || stopped) return;
      const { ticket } = await response.json() as { ticket: string };
      const endpoint = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
      provider = new WebsocketProvider(endpoint, `doc-${docId}`, ydoc, { params: { ticket } });
      provider.on("sync", (synced: boolean) => { if (synced && text.length === 0 && initialBody) text.insert(0, initialBody); });
    });
    return () => { stopped = true; textarea.removeEventListener("input", onInput); text.unobserve(updateDom); provider?.destroy(); ydoc.destroy(); };
  }, [docId, disabled, initialBody, onChange]);
  return <Textarea ref={ref} aria-label="Collaborative document body" disabled={disabled} className="min-h-64 font-mono text-sm" placeholder="Write together…" />;
}
