/**
 * 产品工作流主图定义
 *
 * 使用 LangGraph 构建完整的产品管理工作流图，包含以下节点链：
 * parse_user_input -> request_agent -> planner_agent -> executor-* -> planner_agent -> END。
 * 通过 product-workflow-node 中的 Executor 节点和路由逻辑实现 DAG 的动态规划与执行。
 *
 * Responsibilities:
 * - 定义 WorkflowGraphInput / WorkflowGraphResult 接口
 * - 组装 LangGraph StateGraph，连接所有节点和条件边
 * - 导出 streamWorkflowGraph() 流式执行入口（从 conversation 流中截取 <user-input> 后驱动）
 * - 导出 runWorkflowGraph() 同步执行入口
 *
 * Notes:
 * - 此文件是产品工作流的路由中枢，后续扩展流程阶段应在此添加节点和边
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  RequestAnalysis,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";
import type { ProductWorkflowStreamEvent } from "../agents/product-workflow/agent";
import {
  aiShippingExecutorNode,
  dataAnalyticsExecutorNode,
  executorBatchBarrierNode,
  gtmExecutorNode,
  interfaceCraftExecutorNode,
  marketResearchExecutorNode,
  marketingGrowthExecutorNode,
  productDiscoveryExecutorNode,
  plannerAgentNode,
  productExecutionExecutorNode,
  productStrategyExecutorNode,
  selectNextProductWorkflowNodes,
  toolkitExecutorNode,
} from "./nodes/product-workflow-node";
import { parseUserInputNode, requestAgentNode } from "./nodes/request-node";
import { WorkflowGraphState, type WorkflowGraphStateValue } from "./state";

export interface WorkflowGraphInput {
  workspaceId?: string;
  productContext?: string;
  userInputBlock: string;
  signal?: AbortSignal;
}

export interface WorkflowGraphResult {
  requestAnalysis: RequestAnalysis;
  requestAnalysisBlock: string;
  userInput: UserInputRecord[];
  plan?: TaskExecutionPlan | null;
  executorResults: ExecutorAgentResult[];
  productWorkflow?: ProductWorkflowResult | null;
}

export type WorkflowGraphStreamEvent =
  | { type: "reasoning"; content: string; agentType: "request" }
  | { type: "request-analysis-start"; agentType: "request" }
  | {
      type: "request-analysis-complete";
      content: string;
      analysis: RequestAnalysis;
      agentType: "request";
    }
  | ProductWorkflowStreamEvent;

/**
 * Executor 节点完成后可继续路由的 LangGraph 目标集合。
 */
const PRODUCT_WORKFLOW_ROUTE_TARGETS = {
  "executor-product-strategy": "executor-product-strategy",
  "executor-market-research": "executor-market-research",
  "executor-gtm": "executor-gtm",
  "executor-product-discovery": "executor-product-discovery",
  "executor-product-execution": "executor-product-execution",
  "executor-marketing-growth": "executor-marketing-growth",
  "executor-data-analytics": "executor-data-analytics",
  "executor-ai-shipping": "executor-ai-shipping",
  "executor-toolkit": "executor-toolkit",
  "executor-interface-craft": "executor-interface-craft",
  planner_agent: "planner_agent",
  end: END,
} as const;

/**
 * Meta PM Agent 的 LangGraph 主图，负责从用户输入整理到产品工作流的阶段规划。
 */
export const graph = new StateGraph(WorkflowGraphState)
  // 将 Conversation Agent 的 <user-input> block 转成结构化输入。
  .addNode("parse_user_input", parseUserInputNode)
  // Request Agent 负责对用户输入进行业务建模分类。
  .addNode("request_agent", requestAgentNode)
  // Planner Agent 负责把业务建模项规划为可执行 DAG。
  .addNode("planner_agent", plannerAgentNode)
  // 10 个 Executor Agent 分别负责各自领域的图谱增量。
  .addNode("executor-product-strategy", productStrategyExecutorNode)
  .addNode("executor-market-research", marketResearchExecutorNode)
  .addNode("executor-gtm", gtmExecutorNode)
  .addNode("executor-product-discovery", productDiscoveryExecutorNode)
  .addNode("executor-product-execution", productExecutionExecutorNode)
  .addNode("executor-marketing-growth", marketingGrowthExecutorNode)
  .addNode("executor-data-analytics", dataAnalyticsExecutorNode)
  .addNode("executor-ai-shipping", aiShippingExecutorNode)
  .addNode("executor-toolkit", toolkitExecutorNode)
  .addNode("executor-interface-craft", interfaceCraftExecutorNode)
  .addNode("executor_batch_barrier", executorBatchBarrierNode)
  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addConditionalEdges("request_agent", selectNextNodeAfterRequestAgent, {
    planner_agent: "planner_agent",
    end: END,
  })
  .addConditionalEdges("planner_agent", selectNextProductWorkflowNodes, {
    "executor-product-strategy": "executor-product-strategy",
    "executor-market-research": "executor-market-research",
    "executor-gtm": "executor-gtm",
    "executor-product-discovery": "executor-product-discovery",
    "executor-product-execution": "executor-product-execution",
    "executor-marketing-growth": "executor-marketing-growth",
    "executor-data-analytics": "executor-data-analytics",
    "executor-ai-shipping": "executor-ai-shipping",
    "executor-toolkit": "executor-toolkit",
    "executor-interface-craft": "executor-interface-craft",
    planner_agent: "planner_agent",
    end: END,
  })
  .addEdge("executor-product-strategy", "executor_batch_barrier")
  .addEdge("executor-market-research", "executor_batch_barrier")
  .addEdge("executor-gtm", "executor_batch_barrier")
  .addEdge("executor-product-discovery", "executor_batch_barrier")
  .addEdge("executor-product-execution", "executor_batch_barrier")
  .addEdge("executor-marketing-growth", "executor_batch_barrier")
  .addEdge("executor-data-analytics", "executor_batch_barrier")
  .addEdge("executor-ai-shipping", "executor_batch_barrier")
  .addEdge("executor-toolkit", "executor_batch_barrier")
  .addEdge("executor-interface-craft", "executor_batch_barrier")
  .addConditionalEdges(
    "executor_batch_barrier",
    selectNextProductWorkflowNodes,
    PRODUCT_WORKFLOW_ROUTE_TARGETS,
  )
  .compile();

/**
 * 运行完整 LangGraph 主图，适用于不需要 SSE 中间事件的调用场景。
 */
export async function runWorkflowGraph(
  input: WorkflowGraphInput,
): Promise<WorkflowGraphResult> {
  const result = await graph.invoke(
    {
      productContext: input.productContext ?? "",
      workspaceId: input.workspaceId,
      userInputBlock: input.userInputBlock,
    },
    { signal: input.signal },
  );

  if (!result.requestAnalysis) {
    throw new Error("Workflow graph completed without request analysis.");
  }

  return {
    requestAnalysis: result.requestAnalysis,
    requestAnalysisBlock: result.requestAnalysisBlock,
    userInput: result.userInput,
    plan: result.plan,
    executorResults: result.executorResults,
    productWorkflow: result.productWorkflow,
  };
}

/**
 * 流式运行主工作图，供 SSE 路径复用图编排并保留中间 Agent 事件。
 */
export async function* streamWorkflowGraph(
  input: WorkflowGraphInput,
): AsyncGenerator<WorkflowGraphStreamEvent> {
  const stream = await graph.stream(
    {
      productContext: input.productContext ?? "",
      workspaceId: input.workspaceId,
      userInputBlock: input.userInputBlock,
    },
    { signal: input.signal, streamMode: "custom" },
  );

  for await (const event of stream) {
    yield event as WorkflowGraphStreamEvent;
  }
}

/**
 * 根据 Request Agent 是否识别到业务建模项，决定是否进入产品工作流。
 */
function selectNextNodeAfterRequestAgent(state: WorkflowGraphStateValue) {
  return state.requestAnalysis?.business_model.length
    ? "planner_agent"
    : "end";
}
