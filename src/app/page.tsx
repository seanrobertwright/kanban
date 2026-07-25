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
import { PortfolioButton } from "@/features/workspaces/components/portfolio-dialog";
import { ReportsButton } from "@/features/reports/components/reports-dialog";
import { ProgramsButton } from "@/features/programs/components/programs-dialog";
import { ScaledAgileButton } from "@/features/teams/components/scaled-agile-dialog";
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
import { DocsButton } from "@/features/docs/components/docs-dialog";
import { ChatButton } from "@/features/chat/components/chat-dialog";
import { WhiteboardsButton } from "@/features/whiteboards/components/whiteboards-dialog";
import { AdminConsoleButton } from "@/features/admin/components/admin-console-dialog";
import { CommandPaletteTrigger } from "@/features/board/components/command-palette";
import { BoardExtensionActions } from "@/features/extensions/components/board-extension-actions";
import { KnowledgeButton } from "@/features/knowledge/components/knowledge-dialog";

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

  // Neon accent per member for the header avatar stack, assigned stably by
  // hashing the user id over the design language's fixed accent family.
  const AVATAR_ACCENTS = [
    "var(--neon-cyan)",
    "var(--neon-green)",
    "var(--neon-magenta)",
    "var(--neon-orange)",
    "var(--neon-purple)",
  ];
  const accentOf = (id: string) =>
    AVATAR_ACCENTS[
      [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) %
        AVATAR_ACCENTS.length
    ];
  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

  // The workspace tool cluster renders in the sidebar on wide screens and
  // falls back into the header on small ones. Each *Button owns its dialog,
  // which portals out of this container — so the width override below only
  // ever reaches the trigger buttons themselves.
  const tools = (
    <>
      <BoardExtensionActions workspaceId={data.board.workspaceId} />
      <KnowledgeButton workspaceId={data.board.workspaceId} />
      <DocsButton workspaceId={data.board.workspaceId} canManage={canEdit} />
      <ChatButton workspaceId={data.board.workspaceId} canEdit={canEdit} />
      <WhiteboardsButton boardId={data.board.id} canEdit={canEdit} />
      <ProgramsButton
        workspaceId={data.board.workspaceId}
        canManage={canDeleteColumns}
      />
      <ScaledAgileButton
        workspaceId={data.board.workspaceId}
        canManage={canDeleteColumns}
      />
      <PortfolioButton workspaceId={data.board.workspaceId} />
      <ReportsButton
        workspaceId={data.board.workspaceId}
        boards={boards
          .filter((b) => b.workspaceId === data.board.workspaceId)
          .map((b) => ({ id: b.id, name: b.name }))}
      />
      <AdminConsoleButton
        workspace={workspace}
        currentUserId={session.user.id}
        boards={boards.filter((b) => b.workspaceId === data.board.workspaceId)}
      />
    </>
  );

  return (
    <div className="flex min-h-dvh w-full flex-1">
      {/* SIDEBAR — the design synthesis shell: brand, board switcher, tools. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur-md md:flex">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <div
            className="glow-sm flex size-7 items-center justify-center rounded-md bg-linear-to-br from-primary to-[#0577b8] font-heading text-sm font-black text-primary-foreground"
            aria-hidden
          >
            K
          </div>
          <div className="font-heading text-sm font-bold tracking-[0.2em] text-foreground dark:text-glow">
            KANBAN
          </div>
        </div>

        <div className="px-3 pb-1">
          <CommandPaletteTrigger />
        </div>

        <div className="label-mono px-4 pt-2 pb-1 text-muted-foreground/70">
          {"// Workspace"}
        </div>
        <div className="px-2">
          <BoardSwitcher
            workspaces={workspaces}
            boards={boards}
            currentBoardId={data.board.id}
            currentUserId={session.user.id}
          />
        </div>

        <div className="label-mono px-4 pt-4 pb-1 text-muted-foreground/70">
          {"// Tools"}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start">
          {tools}
        </nav>

        <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
          <UserMenu user={session.user} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {session.user.name}
            </div>
            <div className="label-mono truncate text-muted-foreground/80">
              {workspace.role}
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b bg-background/60 px-5 py-3 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[13px]">
            <span
              className="glow-sm size-2 shrink-0 rounded-xs bg-primary"
              aria-hidden
            />
            <span className="truncate text-muted-foreground">
              {workspace.name}
            </span>
            <span className="text-border">/</span>
            <span className="truncate tracking-wide text-foreground uppercase">
              {data.board.name}
            </span>
          </div>
          <p className="hidden text-sm text-muted-foreground xl:block">
            {canEdit
              ? "Drag tasks between columns to update their status."
              : "You have view-only access to this workspace."}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <div className="mr-1 hidden sm:flex" aria-label="Workspace members">
              {members.slice(0, 4).map((member, i) => (
                <div
                  key={member.userId}
                  title={member.name}
                  className={`flex size-6.5 items-center justify-center rounded-md border-2 border-background text-[10px] font-bold text-background ${i > 0 ? "-ml-2" : ""}`}
                  style={{ background: accentOf(member.userId) }}
                >
                  {initialsOf(member.name)}
                </div>
              ))}
              {members.length > 4 && (
                <div className="-ml-2 flex size-6.5 items-center justify-center rounded-md border-2 border-background bg-secondary text-[10px] font-bold text-secondary-foreground">
                  +{members.length - 4}
                </div>
              )}
            </div>
            <NotificationBell workspaceId={data.board.workspaceId} />
            <div className="md:hidden">
              <ThemeToggle />
            </div>
            <div className="md:hidden">
              <UserMenu user={session.user} />
            </div>
          </div>
          {/* Small screens have no sidebar — surface the tools inline. */}
          <div className="flex w-full flex-wrap items-center gap-1 md:hidden">
            {tools}
          </div>
        </header>
        {/* Keyed by board id: the Board holds columns and tasks in state, and
            switching boards re-renders this page at the same position — without a
            key, React would keep the previous board's state and show its columns
            under the new board's name. */}
        <div className="flex min-w-0 flex-1 flex-col p-5">
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
            initialEpics={data.epics}
            initialSprints={data.sprints}
            initialDependencies={data.dependencies}
            initialCustomFields={data.customFields}
            initialObjectives={data.objectives}
            canEdit={canEdit}
            canDeleteColumns={canDeleteColumns}
          />
        </div>
      </main>
    </div>
  );
}
