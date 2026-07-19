"use client";

import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import * as api from "../client/api";
import { formatMinutes, type TaskTime } from "../types";

interface TimeSectionProps {
  taskId: number;
  /** After any write — every one logs a history row the feed should show. */
  onChanged?: () => void;
}

/**
 * The task's time ledger (027), a dialog section in the checklist's shape:
 * self-fetching, keyed by task. The total leads because it is the number the
 * section exists for; the entries under it are its receipt.
 */
export function TimeSection({ taskId, onChanged }: TimeSectionProps) {
  const [time, setTime] = useState<TaskTime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchTaskTime(taskId);
        if (!cancelled) setTime(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load time");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, version]);

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function log() {
    const parsed = parseInt(minutes, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    await mutate(async () => {
      await api.addTimeEntry(taskId, parsed, note.trim());
      setMinutes("");
      setNote("");
    });
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Time
        {time && time.totalMinutes > 0 && (
          <span className="ml-1 tabular-nums">
            — {formatMinutes(time.totalMinutes)} logged
          </span>
        )}
      </p>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {time && time.entries.length > 0 && (
        <ul className="grid gap-1">
          {time.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {formatMinutes(entry.minutes)}
                </span>{" "}
                · {entry.userName ?? "A removed user"} ·{" "}
                <time dateTime={entry.spentOn}>{entry.spentOn}</time>
                {entry.note && <> · {entry.note}</>}
              </span>
              {entry.canDelete && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() =>
                    confirmingId === entry.id
                      ? mutate(() => api.deleteTimeEntry(entry.id))
                      : setConfirmingId(entry.id)
                  }
                  onBlur={() => setConfirmingId(null)}
                >
                  {confirmingId === entry.id ? "Really?" : "Delete"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Not a <form>: this sits inside the task form — the comment box's
          rule, buttons type="button" included. */}
      <div className="flex gap-1.5">
        <Input
          aria-label="Minutes spent"
          type="number"
          min={1}
          className="w-24 shrink-0"
          placeholder="Min"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <Input
          aria-label="What the time went to"
          placeholder="What for? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !minutes.trim()}
          onClick={log}
        >
          Log
        </Button>
      </div>
    </div>
  );
}
