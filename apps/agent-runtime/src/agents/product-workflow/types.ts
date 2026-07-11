/**
 * 产品工作流类型定义
 *
 * 定义产品工作流中 Planner Agent、Executor Agent、Critique Agent 和各工作流阶段的
 * 公共输入输出类型及流事件类型。
 *
 * Responsibilities:
 * - 定义 ProductWorkflowInput / PlannerAgentInput / ExecutorAgentInput 等输入类型
 * - 定义 ProductWorkflowStreamEvent 流事件联合类型
 * - 定义 CritiqueAgentInput 收尾审查节点输入类型
 */

import type {
  ExecutorAgentResult,
  OrchestratorAgentResult,
  OrchestratorContextSource,
  ProductWorkflowResult,
  ProductKnowledgeGraph,
  ProductWorkflowAgentType,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../request/user-input";
import type { ExecutorAgentType } from "./executor-agent/definitions";

/**
 * 产品工作流的公共输入，贯穿 Planner 与 Executor。
 */
export interface ProductWorkflowInput {
  workspaceId?: string;
  productContext?: string;
  contextSource?: OrchestratorContextSource;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

export interface WorkflowResumeContext {
  requestAnalysis?: RequestAnalysis | null;
  orchestratorDecision?: OrchestratorAgentResult | null;
  plan?: TaskExecutionPlan | null;
  executorResults?: ExecutorAgentResult[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  rerunTaskIds?: string[];
  forceSupplementPlan?: boolean;
  supplementAgentTypes?: ExecutorAgentType[];
}

/**
 * Planner Agent 节点输入，包含 Request Agent 结果和当前产品知识图谱快照。
 */
export interface PlannerAgentInput extends ProductWorkflowInput {
  knowledgeGraph: ProductKnowledgeGraph;
  supplementAgentTypes?: ExecutorAgentType[];
}

/**
 * Orchestrator Agent 节点输入，包含 Request Agent 结果和上下文来源。
 */
export interface OrchestratorAgentInput extends ProductWorkflowInput {
  knowledgeGraph: ProductKnowledgeGraph;
  supplementAgentTypes?: ExecutorAgentType[];
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
 * Critique Agent 收尾节点输入，用于审查 Planner 与 Executor 的产出。
 */
export interface CritiqueAgentInput {
  workspaceId?: string;
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  plan: TaskExecutionPlan;
  executorResults: ExecutorAgentResult[];
  knowledgeGraph: ProductKnowledgeGraph;
  userInput?: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * 历史兼容别名：旧模块仍可引用 PlannerWorkflowReviewInput。
 */
export type PlannerWorkflowReviewInput = CritiqueAgentInput;

/**
 * 产品工作流向 LangGraph/API/SSE 暴露的内部流事件。
 */
export type ProductWorkflowStreamEvent =
  | {
      type: "agent-status";
      agentType: ProductWorkflowAgentType;
      status: "started" | "completed";
      phase?: "planning" | "execution" | "review";
      parallelAgents?: ProductWorkflowAgentType[];
    }
  | {
      type: "reasoning";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | {
      type: "subagent-start";
      agentType: ProductWorkflowAgentType;
      subagentType: string;
      toolCallId?: string;
      description?: string;
    }
  | {
      type: "subagent-thinking";
      agentType: ProductWorkflowAgentType;
      subagentType: string;
      toolCallId?: string;
      content: string;
    }
  | {
      type: "subagent-result";
      agentType: ProductWorkflowAgentType;
      subagentType: string;
      toolCallId?: string;
      result: unknown;
    }
  | {
      type: "agent-output";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType: ProductWorkflowAgentType;
    }
  | {
      type: "tool-result";
      toolCallId?: string;
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
      parallelAgents?: ProductWorkflowAgentType[];
    }
  | { type: "complete"; result: ProductWorkflowResult }
  | { type: "knowledge-graph-update"; knowledgeGraph: ProductKnowledgeGraph };
