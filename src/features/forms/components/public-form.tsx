"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import type { FormField } from "../types";

/**
 * The anonymous fill-and-submit surface behind a public form token (§3.9). No
 * session anywhere: the POST goes to the token route, which is the entire
 * authorization, and success shows a receipt rather than the task — a public
 * submitter has no standing to see the board their request landed on.
 */
export function PublicForm({
  token,
  fields,
}: {
  token: string;
  fields: FormField[];
}) {
  const [answers, setAnswers] = useState<string[]>(fields.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(index: number, value: string) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/forms/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: string } | null)?.error ??
            `Submission failed (${res.status})`
        );
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-lg border bg-muted/30 p-4 text-sm">
        Thanks — your request has been submitted.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {fields.map((field, i) => (
        <div key={i} className="grid gap-1">
          <Label htmlFor={`public-field-${i}`}>
            {field.label}
            {(field.required || i === 0) && (
              <span className="text-destructive"> *</span>
            )}
          </Label>
          {field.type === "textarea" ? (
            <Textarea
              id={`public-field-${i}`}
              value={answers[i]}
              rows={3}
              onChange={(e) => set(i, e.target.value)}
            />
          ) : (
            <Input
              id={`public-field-${i}`}
              type={field.type === "number" ? "number" : "text"}
              value={answers[i]}
              onChange={(e) => set(i, e.target.value)}
            />
          )}
        </div>
      ))}
      <Button type="submit" className="justify-self-start" disabled={busy}>
        Submit
      </Button>
    </form>
  );
}
