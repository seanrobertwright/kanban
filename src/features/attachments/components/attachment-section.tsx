"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Paperclip, Upload, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import * as api from "../client/api";
import { ATTACHMENT_MAX_BYTES, type Attachment } from "../types";

interface AttachmentSectionProps {
  taskId: number;
  /** After any change — the card's paperclip count is now stale. */
  onChanged?: () => void;
}

/** Bytes in the unit that reads at a glance — the size a person scans, not exact. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A task's files, self-contained like the checklist section: it fetches its own
 * list when mounted (the dialog mounts it for an open task) and refetches after
 * every change. Uploads and deletes go through the app, which authorizes each
 * one — the download link is a plain href the server streams with the right
 * headers, so there is no public URL to leak.
 */
export function AttachmentSection({ taskId, onChanged }: AttachmentSectionProps) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await api.fetchAttachments(taskId);
        if (active) setItems(next);
      } catch {
        // Leave the list empty if it cannot be read; the next open retries.
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [taskId]);

  async function reload() {
    try {
      setItems(await api.fetchAttachments(taskId));
    } catch {
      // keep what is on screen
    }
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file || busy) return;
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(
        `That file is larger than ${Math.floor(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadAttachment(taskId, file);
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the file");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Attachment) {
    setError(null);
    setItems((prev) => prev.filter((a) => a.id !== item.id));
    try {
      await api.deleteAttachment(item.id);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it");
      void reload();
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Attachments{items.length > 0 ? ` (${items.length})` : ""}
      </p>

      {items.length > 0 && (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {/* A plain link — the download route sets Content-Disposition, so
                  the browser saves it under the original name. */}
              <a
                href={api.attachmentDownloadUrl(item.id)}
                className="flex-1 truncate text-sm hover:underline"
                title={item.name}
              >
                {item.name}
              </a>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatBytes(item.size)}
              </span>
              <a
                href={api.attachmentDownloadUrl(item.id)}
                aria-label={`Download ${item.name}`}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3.5" />
              </a>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => remove(item)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        onChange={onPick}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 justify-self-start"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload /> {busy ? "Uploading…" : "Add file"}
      </Button>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
