"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, Plus, Users, Webhook } from "lucide-react";

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
import * as api from "../client/api";
import { AgentsDialog } from "@/features/agents/components/agents-dialog";
import { WebhooksDialog } from "@/features/webhooks/components/webhooks-dialog";
import { CreateDialog } from "./create-dialog";
import { MembersDialog } from "./members-dialog";
import type { Board, WorkspaceMembership } from "../types";

interface BoardSwitcherProps {
  /** Every workspace the user belongs to, in the order they should be listed. */
  workspaces: WorkspaceMembership[];
  /** Every board across `workspaces` — grouped by workspace for display. */
  boards: Board[];
  currentBoardId: number;
  currentUserId: string;
}

export function BoardSwitcher({
  workspaces,
  boards,
  currentBoardId,
  currentUserId,
}: BoardSwitcherProps) {
  const router = useRouter();
  const [membersOpen, setMembersOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  /** The workspace a new board is being created in, or null when idle. */
  const [newBoardIn, setNewBoardIn] = useState<WorkspaceMembership | null>(null);

  const currentBoard = boards.find((b) => b.id === currentBoardId);
  const currentWorkspace =
    workspaces.find((w) => w.id === currentBoard?.workspaceId) ?? workspaces[0];

  // Base UI unmounts the menu popup as it closes, and mounting a dialog in the
  // same commit loses the focus hand-off — so every menu-item-opens-a-dialog
  // path defers to the next tick.
  function openLater(open: () => void) {
    setTimeout(open, 0);
  }

  async function handleCreateBoard(name: string) {
    if (!newBoardIn) return;
    const board = await api.createBoard(newBoardIn.id, name);
    router.push(`/?board=${board.id}`);
    // The page reads boards on the server; refresh so the new one is listed
    // rather than appearing only after a hard reload.
    router.refresh();
  }

  async function handleCreateWorkspace(name: string) {
    const { board } = await api.createWorkspace(name);
    router.push(`/?board=${board.id}`);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="gap-2 px-2 font-semibold">
              {currentBoard?.name ?? "Board"}
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-56">
          {/*
            One Group per workspace. DropdownMenuLabel is Base UI's Menu.GroupLabel
            (not Radix's standalone Label) — it reads MenuGroupContext to label its
            group and throws outside a Group. That is also what the markup means
            here: each label names the boards beneath it.
          */}
          {workspaces.map((workspace) => {
            const workspaceBoards = boards.filter(
              (b) => b.workspaceId === workspace.id
            );
            const canCreateBoard =
              workspace.role === "owner" || workspace.role === "admin";

            return (
              <DropdownMenuGroup key={workspace.id}>
                <DropdownMenuLabel>
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium">{workspace.name}</span>
                    <span className="text-xs font-normal text-muted-foreground capitalize">
                      {workspace.role}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspaceBoards.map((board) => (
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
                {/* Board creation is admin+, so viewers and members are not
                    offered an action the server would refuse. */}
                {canCreateBoard && (
                  <DropdownMenuItem
                    onClick={() => openLater(() => setNewBoardIn(workspace))}
                  >
                    <Plus /> New board
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            );
          })}

          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => openLater(() => setMembersOpen(true))}
            >
              <Users /> Members
            </DropdownMenuItem>
            {/* Managing agents is admin+, so viewers and members are not offered
                an action the server would refuse. */}
            {(currentWorkspace.role === "owner" ||
              currentWorkspace.role === "admin") && (
              <DropdownMenuItem
                onClick={() => openLater(() => setAgentsOpen(true))}
              >
                <Bot /> Agents
              </DropdownMenuItem>
            )}
            {/* Webhooks are infrastructure, so admin+ like agents (025). */}
            {(currentWorkspace.role === "owner" ||
              currentWorkspace.role === "admin") && (
              <DropdownMenuItem
                onClick={() => openLater(() => setWebhooksOpen(true))}
              >
                <Webhook /> Webhooks
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => openLater(() => setNewWorkspaceOpen(true))}
            >
              <Plus /> New workspace
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        workspace={currentWorkspace}
        currentUserId={currentUserId}
      />

      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        workspace={currentWorkspace}
      />

      <WebhooksDialog
        open={webhooksOpen}
        onOpenChange={setWebhooksOpen}
        workspace={currentWorkspace}
      />

      <CreateDialog
        open={newBoardIn !== null}
        onOpenChange={(open) => !open && setNewBoardIn(null)}
        title="New board"
        description={`Adds a board to ${newBoardIn?.name ?? ""}.`}
        label="Board name"
        placeholder="Roadmap"
        onSubmit={handleCreateBoard}
      />

      <CreateDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        title="New workspace"
        description="Workspaces have their own boards and members. You will be its owner."
        label="Workspace name"
        placeholder="Acme Inc"
        onSubmit={handleCreateWorkspace}
      />
    </>
  );
}
