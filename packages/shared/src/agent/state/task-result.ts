import { Artifact } from "./workflow-state";

export interface TaskResult {
  taskId: string;

  success: boolean;

  output: unknown;

  artifacts: Artifact[];

  executionTimeMs: number;

  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };

  error?: string;
}
