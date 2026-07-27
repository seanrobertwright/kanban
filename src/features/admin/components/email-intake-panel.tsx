"use client";

import { useCallback, useState } from "react";

import { Button } from "@/shared/ui/button";
import * as api from "@/features/workspaces/client/api";
import type { WorkspaceMembership } from "@/features/workspaces/types";
import { usePanelLoad } from "./use-panel-load";
import type { BoardIntakeAddress } from "../types";

/**
 * The inbound email addresses, one per board — the surface for a capability
 * that existed server-side long before anything showed users the address.
 *
 * Intake needs a configured inbound gateway, so the panel has two honest
 * states: the addresses, or the sentence saying the deployment has not set one
 * up. It never shows an address that would bounce.
 */
export function EmailIntakePanel({ workspace }: { workspace: WorkspaceMembership }) {
  const [intake, setIntake] = useState<{
    configured: boolean;
    addresses: BoardIntakeAddress[];
  } | null>(null);
  const [copiedBoardId, setCopiedBoardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIntake(await api.fetchEmailIntake(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load email intake");
    }
  }, [workspace.id]);

  usePanelLoad(load);

  async function copy(address: BoardIntakeAddress) {
    try {
      await navigator.clipboard.writeText(address.address);
      setCopiedBoardId(address.boardId);
      setTimeout(() => setCopiedBoardId(null), 1500);
    } catch {
      setError("Could not copy the address");
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        Send mail to a board&rsquo;s address to create a task; reply to a task
        notification to comment. Members only, verified by the inbound gateway.
      </p>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {intake && !intake.configured && (
        <p className="text-sm text-muted-foreground">
          This deployment has no inbound mail gateway configured, so there are no
          intake addresses to show.
        </p>
      )}

      {intake?.configured && intake.addresses.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No boards have an intake address yet.
        </p>
      )}

      {intake?.configured && intake.addresses.length > 0 && (
        <div className="grid gap-1">
          {intake.addresses.map((address) => (
            <div
              key={address.boardId}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            >
              <span className="shrink-0 text-muted-foreground">
                {address.boardName}
              </span>
              <code className="min-w-0 flex-1 truncate">{address.address}</code>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void copy(address)}
              >
                {copiedBoardId === address.boardId ? "Copied" : "Copy"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
