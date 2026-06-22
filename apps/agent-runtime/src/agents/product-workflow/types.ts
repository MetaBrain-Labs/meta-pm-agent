import type {
  ExecutorAgentResult,
  ProductDirectorWorkflowResult,
  ProductKnowledgeGraph,
  ProductWorkflowAgentType,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../request/user-input";

/**
 * 产品工作流的公共输入，贯穿 Planner、Executor 与 ProductDirector。
 */
export interface ProductDirectorWorkflowInput {
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * Planner Agent 节点输入，包含 Request Agent 结果和当前产品知识图谱快照。
 */
export interface PlannerAgentInput extends ProductDirectorWorkflowInput {
  knowledgeGraph: ProductKnowledgeGraph;
}

/**
 * Executor Agent 节点输入，描述当前任务、完整 DAG 和已完成任务结果。
 */
export interface ExecutorAgentInput extends ProductDirectorWorkflowInput {
  task: TaskExecutionNode;
  plan: TaskExecutionPlan;
  knowledgeGraph: ProductKnowledgeGraph;
  previousResults: ExecutorAgentResult[];
}

/**
 * ProductDirector Agent 验收节点输入，用于汇总 Planner 与 Executor 的产出。
 */
export interface ProductDirectorReviewInput {
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
  | { type: "complete"; result: ProductDirectorWorkflowResult };
