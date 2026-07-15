export interface Task {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  createdAt: string;
}

export interface CreateTaskInput {
  columnId: number;
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
}

export interface MoveTaskInput {
  columnId: number;
  position: number;
}
