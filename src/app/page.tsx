import { notFound, redirect } from "next/navigation";

import { listWorkspaceAgents } from "@/features/agents/server/repository";
import { NotificationBell } from "@/features/activity/components/notification-bell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { getSession } from "@/features/auth/server/session";
import { Board } from "@/features/board/components/board";
import { getBoard } from "@/features/board/server/repository";
import type { BoardData } from "@/features/board/types";
import { listLabels } from "@/features/labels/server/repository";
import { BoardSwitcher } from "@/features/workspaces/components/board-switcher";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  listMembers,
  redeemInvitations,
} from "@/features/workspaces/server/members";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
  listBoardsForUser,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { listSavedViews } from "@/features/views/server/repository";
import { listTemplates } from "@/features/templates/server/repository";
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

  // Members come down with the board rather than being fetched by the client:
  // the assignee picker needs them the moment a dialog opens, and every card
  // that shows a face needs them on first paint. Both resolve names and avatars
  // from this one list, which is why Task carries only an assignee id.
  //
  // Labels ride along for the same reason and are read against the *workspace*,
  // not the board — 007 scopes the vocabulary there, so this list is the same
  // for every board a user switches between. Cards need it on first paint for
  // chip colour, and the picker needs it the moment a dialog opens.
  // Agents ride down beside members and for the same reason (011): the picker
  // shows them as another kind of assignee, and every card with an agent on it
  // resolves that agent's name and face from this one roster on first paint —
  // which is why Task carries only an assignee's {type, id}, not its display data.
  const [workspaces, boards, members, agents, labels, savedViews, templates] =
    await Promise.all([
      listWorkspacesForUser(session.user.id),
      listBoardsForUser(session.user.id),
      listMembers(session.user.id, data.board.workspaceId),
      listWorkspaceAgents(session.user.id, data.board.workspaceId),
      listLabels(session.user.id, data.board.workspaceId),
      // Private to this user (015), scoped to the workspace — the same for every
      // board they switch to within it.
      listSavedViews(session.user.id, data.board.workspaceId),
      // Shared across the workspace (019), for the New-task dialog's "start from
      // a template" picker — workspace-scoped, so the same for every board.
      listTemplates(session.user.id, data.board.workspaceId),
    ]);
  const workspace = workspaces.find((w) => w.id === data.board.workspaceId)!;
  const canEdit = workspace.role !== "viewer";
  // Only deleting a column needs the extra rank — §7.4's blast-radius rule,
  // applied to people rather than to agent tools.
  const canDeleteColumns =
    workspace.role === "admin" || workspace.role === "owner";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <BoardSwitcher
            workspaces={workspaces}
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
          <NotificationBell workspaceId={data.board.workspaceId} />
          <ThemeToggle />
          <UserMenu user={session.user} />
        </div>
      </header>
      {/* Keyed by board id: the Board holds columns and tasks in state, and
          switching boards re-renders this page at the same position — without a
          key, React would keep the previous board's state and show its columns
          under the new board's name. */}
      <Board
        key={data.board.id}
        boardId={data.board.id}
        columns={data.columns}
        initialTasks={data.tasks}
        members={members}
        agents={agents}
        initialLabels={labels}
        workspaceId={data.board.workspaceId}
        initialSavedViews={savedViews}
        initialDoneColumnId={data.doneColumnId}
        initialTemplates={templates}
        initialMilestones={data.milestones}
        initialSprints={data.sprints}
        canEdit={canEdit}
        canDeleteColumns={canDeleteColumns}
      />
    </main>
  );
}
