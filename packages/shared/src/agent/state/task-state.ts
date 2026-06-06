import { TaskResult } from "./task-result";

export interface TaskState {
  taskId: string;

  status: TaskStatus;

  startedAt?: number;

  completedAt?: number;

  retries: number;

  result?: TaskResult;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";
