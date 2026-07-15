"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Users } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MembersDialog } from "./members-dialog";
import type { Board, WorkspaceMembership } from "../types";

interface BoardSwitcherProps {
  workspace: WorkspaceMembership;
  boards: Board[];
  currentBoardId: number;
  currentUserId: string;
}

export function BoardSwitcher({
  workspace,
  boards,
  currentBoardId,
  currentUserId,
}: BoardSwitcherProps) {
  const router = useRouter();
  const [membersOpen, setMembersOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="gap-2 px-2 font-semibold">
              {boards.find((b) => b.id === currentBoardId)?.name ?? "Board"}
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-56">
          {/*
            DropdownMenuLabel is Base UI's Menu.GroupLabel (not Radix's standalone
            Label) — it reads MenuGroupContext to label its group, so it throws
            outside a Group. Grouping the boards under the workspace name is also
            what the markup means: this label names these items.
          */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">{workspace.name}</span>
                <span className="text-xs font-normal text-muted-foreground capitalize">
                  {workspace.role}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {boards.map((board) => (
              <DropdownMenuItem
                key={board.id}
                onClick={() => router.push(`/?board=${board.id}`)}
              >
                <Check
                  className={
                    board.id === currentBoardId ? "opacity-100" : "opacity-0"
                  }
                />
                {board.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {/* Open on the next tick: the menu unmounts its popup as it closes,
                and mounting the dialog in the same commit loses the focus hand-off. */}
            <DropdownMenuItem onClick={() => setTimeout(() => setMembersOpen(true), 0)}>
              <Users /> Members
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        workspace={workspace}
        currentUserId={currentUserId}
      />
    </>
  );
}
