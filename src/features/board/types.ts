import type { Task } from "@/features/tasks/types";
import type { Board } from "@/features/workspaces/types";

export interface Column {
  id: number;
  boardId: number;
  title: string;
  position: number;
}

export interface BoardData {
  board: Board;
  columns: Column[];
  tasks: Task[];
}
