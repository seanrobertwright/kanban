"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectItem } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_SENTIMENTS,
  FEEDBACK_SOURCE_MAX,
  type FeedbackSentiment,
} from "../types";

/**
 * The anonymous feedback portal behind a public token (3.10 over 043). Sibling
 * of PublicForm and deliberately the same shape: no session anywhere, the POST
 * to the token route is the entire authorization, and success is a receipt
 * rather than the row — a public submitter has no standing to see the board
 * their signal landed on, let alone what the team does with it.
 *
 * Three inputs, and the two optional ones are the whole difference between a
 * signal you can act on and a wall of anonymous text: what KIND of thing this is
 * (the sentiment the inbox groups by) and who it came from — free text, because
 * "Acme, via support" is as useful to a product team as an email address and
 * commits the app to storing nothing about a person it has no relationship with.
 */
export function PublicFeedback({ token }: { token: string }) {
  const [body, setBody] = useState("");
  const [sentiment, setSentiment] = useState<FeedbackSentiment>("idea");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/feedback/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, sentiment, source }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          (payload as { error?: string } | null)?.error ??
            `Submission failed (${res.status})`
        );
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your feedback");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-lg border bg-muted/30 p-4 text-sm">
        Thanks — your feedback reached the team.
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
      <div className="grid gap-1">
        <Label htmlFor="feedback-body">
          Your feedback<span className="text-destructive"> *</span>
        </Label>
        <Textarea
          id="feedback-body"
          rows={5}
          value={body}
          maxLength={FEEDBACK_BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What is working, what is not, or what you wish it did."
        />
      </div>
      <div className="grid gap-1">
        <Label>What kind of feedback is this?</Label>
        <Select
          aria-label="What kind of feedback is this?"
          value={sentiment}
          onValueChange={(value) => setSentiment(value as FeedbackSentiment)}
        >
          {FEEDBACK_SENTIMENTS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="feedback-source">Who are you? (optional)</Label>
        <Input
          id="feedback-source"
          value={source}
          maxLength={FEEDBACK_SOURCE_MAX}
          onChange={(e) => setSource(e.target.value)}
          placeholder="A name, a company, or how you use it"
        />
      </div>
      <Button
        type="submit"
        className="justify-self-start"
        disabled={busy || body.trim() === ""}
      >
        {busy ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
