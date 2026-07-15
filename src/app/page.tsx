import { notFound, redirect } from "next/navigation";

import { UserMenu } from "@/features/auth/components/user-menu";
import { getSession } from "@/features/auth/server/session";
import { Board } from "@/features/board/components/board";
import { getBoard } from "@/features/board/server/repository";
import type { BoardData } from "@/features/board/types";
import { BoardSwitcher } from "@/features/workspaces/components/board-switcher";
import { AuthzError } from "@/features/workspaces/server/authz";
import { redeemInvitations } from "@/features/workspaces/server/members";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
  listBoards,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { ThemeToggle } from "@/shared/theme/theme-toggle";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // Order matters: redeem first, so someone who was invited before they ever
  // signed in lands in that workspace instead of being handed a lonely personal
  // one (ensurePersonalWorkspace no-ops once any membership exists).
  await redeemInvitations(session.user.id, session.user.email);
  await ensurePersonalWorkspace(session.user.id, session.user.name);

  const { board: boardParam } = await searchParams;
  const boardId = boardParam
    ? Number(boardParam)
    : (await getDefaultBoard(session.user.id))?.id;
  if (boardId === undefined || !Number.isInteger(boardId)) notFound();

  let data: BoardData | undefined;
  try {
    data = await getBoard(session.user.id, boardId);
  } catch (error) {
    // A ?board= id in someone else's workspace raises AuthzError("not_found"),
    // and rendering the 404 page is exactly the right answer: to this user it
    // genuinely does not exist.
    if (error instanceof AuthzError) notFound();
    throw error;
  }
  if (!data) notFound();

  const workspaces = await listWorkspacesForUser(session.user.id);
  const workspace = workspaces.find((w) => w.id === data.board.workspaceId)!;
  const boards = await listBoards(session.user.id, workspace.id);
  const canEdit = workspace.role !== "viewer";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <BoardSwitcher
            workspace={workspace}
            boards={boards}
            currentBoardId={data.board.id}
            currentUserId={session.user.id}
          />
          <p className="px-3 text-sm text-muted-foreground">
            {canEdit
              ? "Drag tasks between columns to update their status."
              : "You have view-only access to this workspace."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu user={session.user} />
        </div>
      </header>
      <Board
        boardId={data.board.id}
        columns={data.columns}
        initialTasks={data.tasks}
        canEdit={canEdit}
      />
    </main>
  );
}
