/**
 * 产品工作流类型定义
 *
 * 定义产品工作流中 Planner Agent、Executor Agent 和各工作流阶段的
 * 公共输入输出类型及流事件类型。
 *
 * Responsibilities:
 * - 定义 ProductWorkflowInput / PlannerAgentInput / ExecutorAgentInput 等输入类型
 * - 定义 ProductWorkflowStreamEvent 流事件联合类型
 * - 定义 PlannerWorkflowReviewInput 收尾节点输入类型
 */

import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  ProductKnowledgeGraph,
  ProductWorkflowAgentType,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../request/user-input";

/**
 * 产品工作流的公共输入，贯穿 Planner 与 Executor。
 */
export interface ProductWorkflowInput {
  workspaceId?: string;
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * Planner Agent 节点输入，包含 Request Agent 结果和当前产品知识图谱快照。
 */
export interface PlannerAgentInput extends ProductWorkflowInput {
  knowledgeGraph: ProductKnowledgeGraph;
}

/**
 * Executor Agent 节点输入，描述当前任务、完整 DAG 和已完成任务结果。
 */
export interface ExecutorAgentInput extends ProductWorkflowInput {
  task: TaskExecutionNode;
  plan: TaskExecutionPlan;
  knowledgeGraph: ProductKnowledgeGraph;
  previousResults: ExecutorAgentResult[];
}

/**
 * Planner Agent 收尾节点输入，用于汇总 Planner 与 Executor 的产出。
 */
export interface PlannerWorkflowReviewInput {
  workspaceId?: string;
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  plan: TaskExecutionPlan;
  executorResults: ExecutorAgentResult[];
  knowledgeGraph: ProductKnowledgeGraph;
  signal?: AbortSignal;
}

/**
 * 产品工作流向 LangGraph/API/SSE 暴露的内部流事件。
 */
export type ProductWorkflowStreamEvent =
  | {
      type: "reasoning";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | {
      type: "agent-output";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | {
      type: "tool-call";
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType: ProductWorkflowAgentType;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolResult: unknown;
      agentType: ProductWorkflowAgentType;
    }
  | {
      type: "token-usage";
      agentType: ProductWorkflowAgentType;
      inputTokens: number;
      cacheHitInputTokens: number;
      cacheMissInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costInput: number;
      costOutput: number;
      costTotal: number;
      durationMs: number;
    }
  | { type: "complete"; result: ProductWorkflowResult }
  | { type: "knowledge-graph-update"; knowledgeGraph: ProductKnowledgeGraph };
