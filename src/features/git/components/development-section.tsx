"use client";

import { useEffect, useState } from "react";
import {
  GitBranch,
  GitCommitVertical,
  GitPullRequestArrow,
} from "lucide-react";

import { fetchTaskGitLinks } from "../client/api";
import type { GitLinkState, TaskGitLink } from "../types";

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

export function DevelopmentSection({ taskId }: { taskId: number }) {
  const [links, setLinks] = useState<TaskGitLink[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskGitLinks(taskId);
        if (!cancelled) setLinks(data);
      } catch {
        // A read failure leaves the section silent rather than erroring the whole
        // dialog — the links are supplementary to the task, not the task.
        if (!cancelled) setLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!links || links.length === 0) return null;

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Development</p>
      <ul className="grid gap-1">
        {links.map((link) => {
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
    </div>
  );
}
