/**
 * Executor Agent 可写入知识图谱的主层级。
 */
export type ExecutorFocusLayer =
  | "Goal"
  | "Requirement"
  | "Evidence"
  | "Decision"
  | "Feature"
  | "Component"
  | "Metric"
  | "Custom";

/**
 * 单个 Executor Agent 的运行时职责档案。
 */
export interface ExecutorAgentProfile {
  agentType: string;
  name: string;
  displayName: string;
  domain: string;
  focusLayer: ExecutorFocusLayer;
  graphRole: string;
  skillSource: string;
  referencePath: string;
  allowedEntityTypes: readonly ExecutorFocusLayer[];
  allowedRelationTypes: readonly string[];
  skills: readonly string[];
  executionGuidelines: readonly string[];
}
