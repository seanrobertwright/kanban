import type { Task } from "@/features/tasks/types";
import type { Board } from "@/features/workspaces/types";

export interface Column {
  id: number;
  boardId: number;
  title: string;
  position: number;
  /**
   * How many tasks this column should hold at once (023), or null for no
   * limit. Advice made visible, not a wall: the board renders the count
   * against it and turns loud when over, but a move is never refused — a WIP
   * limit exists to start a conversation about flow, not to teach people to
   * raise the limit.
   */
  wipLimit: number | null;
}

export interface BoardData {
  board: Board;
  columns: Column[];
  tasks: Task[];
  /**
   * The column that completes a task on this board (020), or null if none is
   * designated. A recurring task moved into it spawns its successor. On BoardData
   * rather than Board so the shared Board type — and its other producers — stay
   * untouched; it is a board fact this one read needs, not one every Board carries.
   */
  doneColumnId: number | null;
}
