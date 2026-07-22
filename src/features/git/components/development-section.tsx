"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  GitBranch,
  GitCommitVertical,
  GitPullRequestArrow,
} from "lucide-react";

import { fetchTaskCiStatuses, fetchTaskGitLinks } from "../client/api";
import { suggestBranchName } from "../lib/branch";
import type { GitLinkState, TaskCiStatus, TaskGitLink } from "../types";

/**
 * The Development section (2.4 pull-request links + 2.5 commit links) — the
 * task_git_link rows (2.0) surfaced. Read-only and self-fetching in the
 * TimeSection shape, keyed by task; it renders nothing when a task has no linked
 * artifacts (the CustomFieldsSection "inert until opted into" precedent), so it
 * costs nothing on a task no repo references.
 *
 * No writes: a link's lifecycle is owned by the git host and arrives through the
 * webhook ingress, so there is nothing here for a human to mutate — the section
 * only shows what the repo already told us, each row a link out to the artifact.
 */

const KIND_ICON = {
  pr: GitPullRequestArrow,
  commit: GitCommitVertical,
  branch: GitBranch,
} as const;

/** PR state chips. merged is the terminal success (purple, GitHub's colour),
 *  open the live state, closed the terminal non-merge. */
const STATE_CHIP: Record<GitLinkState, string> = {
  open: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  merged: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  closed: "bg-muted text-muted-foreground",
};

/** What a link reads as: a PR by its title (or #number), a commit by its subject
 *  (or short sha), a branch by its name. */
function linkLabel(link: TaskGitLink): string {
  if (link.kind === "pr") return link.title ?? `#${link.externalId}`;
  if (link.kind === "commit") return link.title ?? link.externalId.slice(0, 7);
  return link.externalId;
}

/** A CI run's glyph + chip by where it is: running (dashed), passed (green
 *  check), failed (red x), or a neutral/terminal-other outcome (muted). */
function ciVisual(ci: TaskCiStatus): {
  Icon: typeof CircleCheck;
  chip: string;
  label: string;
} {
  if (ci.status !== "completed") {
    return { Icon: CircleDashed, chip: "bg-muted text-muted-foreground", label: "running" };
  }
  if (ci.conclusion === "success") {
    return {
      Icon: CircleCheck,
      chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      label: "passed",
    };
  }
  if (ci.conclusion === "failure") {
    return {
      Icon: CircleX,
      chip: "bg-red-500/15 text-red-600 dark:text-red-400",
      label: "failed",
    };
  }
  return { Icon: CircleDashed, chip: "bg-muted text-muted-foreground", label: "skipped" };
}

export function DevelopmentSection({
  taskId,
  taskTitle = "",
}: {
  taskId: number;
  /** The task's title — the slug half of the branch name suggested for it (2.6). */
  taskTitle?: string;
}) {
  const [links, setLinks] = useState<TaskGitLink[] | null>(null);
  const [ci, setCi] = useState<TaskCiStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Both reads are supplementary to the task — a failure of either leaves that
      // part silent rather than erroring the whole dialog.
      const [linkData, ciData] = await Promise.all([
        fetchTaskGitLinks(taskId).catch(() => [] as TaskGitLink[]),
        fetchTaskCiStatuses(taskId).catch(() => [] as TaskCiStatus[]),
      ]);
      if (!cancelled) {
        setLinks(linkData);
        setCi(ciData);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const hasLinks = links && links.length > 0;
  const hasCi = ci && ci.length > 0;
  if (!hasLinks && !hasCi) return null;

  // The branch name to create for further work on this task (2.6). Shown only
  // once the section is live (a repo already references the task), so it stays
  // inert on a task no repo touches — and it resolves back here when pushed,
  // since suggestBranchName is parseBranchRef's inverse.
  const branchName = suggestBranchName(taskId, taskTitle);

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Development</p>
      {hasLinks && (
        <ul className="grid gap-1">
          {links!.map((link) => {
            const Icon = KIND_ICON[link.kind];
            return (
              <li key={link.id} className="flex items-center gap-2 text-xs">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-foreground hover:underline"
                >
                  {linkLabel(link)}
                </a>
                {link.state && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATE_CHIP[link.state]}`}
                  >
                    {link.state}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasCi && (
        <ul className="grid gap-1">
          {ci!.map((run) => {
            const { Icon, chip, label } = ciVisual(run);
            return (
              <li key={run.id} className="flex items-center gap-2 text-xs">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {run.url ? (
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-foreground hover:underline"
                  >
                    {run.title ?? "CI run"}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-foreground">
                    {run.title ?? "CI run"}
                  </span>
                )}
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${chip}`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {/* The branch to cut for more work on this task (2.6). The provider-API
          "create" is live-only; this is the canonical name to use, and it links
          back here once pushed. */}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitBranch className="size-4 shrink-0" aria-hidden />
        <span>Branch:</span>
        <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {branchName}
        </code>
      </p>
    </div>
  );
}
