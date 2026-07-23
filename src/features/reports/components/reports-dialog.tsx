"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { ReportsPanel } from "./reports-panel";

/**
 * Custom & financial reports (5.1 + 5.2), reached from the header beside the
 * portfolio — a build-and-save surface, not a glance-and-close one. The panel is
 * mounted only while the dialog is open so it fetches lazily, matching the other
 * header dialogs.
 */
export function ReportsButton({
  workspaceId,
  boards,
}: {
  workspaceId: string;
  boards: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <BarChart3 /> Reports
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Reports</DialogTitle>
            <DialogDescription>
              Build a report over tasks, time, flow, or spend — save it private or
              share it with the workspace.
            </DialogDescription>
          </DialogHeader>

          {open && <ReportsPanel workspaceId={workspaceId} boards={boards} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
