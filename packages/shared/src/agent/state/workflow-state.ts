import { ExecutionGraph } from "../graph/execution-graph";
import { TaskState } from "./task-state";

export interface WorkflowState {
  // 基础信息
  workflowId: string;

  userInput: string;

  goal: string;

  status: WorkflowStatus;

  // Planner生成
  executionGraph: ExecutionGraph;

  // 当前所有任务状态
  tasks: Record<string, TaskState>;

  // 中间产物
  artifacts: Record<string, Artifact>;

  // 审阅结果
  reviews: ReviewRecord[];

  // 重规划记录
  replans: ReplanRecord[];

  // 最终结果
  finalOutput?: string;

  // 执行元数据
  metadata: WorkflowMetadata;
}

export interface Artifact {
  id: string;

  taskId: string;

  type: AgentType;

  content: unknown;

  createdAt: number;
}

/**
 * TODO：审阅记录——为Executor Agent执行结果负责
 */
export interface ReviewRecord {
  result: string;
}

/**
 * TODO：批判记录——为Planner Agent指定结果负责
 */
export interface ReplanRecord {
  result: string;
}

/**
 * TODO：元数据——填充一些有需要返回的数据
 */
export interface WorkflowMetadata {
  result: string;
}

export type WorkflowStatus =
  | "planning"
  | "executing"
  | "reviewing"
  | "replanning"
  | "completed"
  | "failed";

export type AgentType =
  | "planner"
  | "executor-product-strategy"
  | "executor-market-research"
  | "executor-gtm"
  | "executor-product-discovery"
  | "executor-product-execution"
  | "executor-marketing-growth"
  | "executor-data-analytics"
  | "executor-ai-shipping"
  | "executor-toolkit"
  | "executor-interface-craft"
  | "research"
  | "analysis"
  | "code"
  | "document"
  | "review";
