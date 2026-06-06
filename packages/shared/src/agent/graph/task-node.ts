import { AgentType } from "../state/workflow-state";

export interface TaskNode {
  id: string;

  name: string;

  description: string;

  agentType: AgentType;

  dependencies: string[];

  expectedOutput: string;

  inputArtifacts?: string[];

  outputArtifacts?: string[];

  retryLimit?: number;

  timeoutSeconds?: number;

  condition?: TaskCondition;

  checkpoint?: boolean;

  humanApproval?: boolean;

  metadata?: Record<string, unknown>;
}

export interface TaskCondition {
  expression: string;
}
