/**
 * 产品工作流主图定义
 *
 * 使用 LangGraph 构建完整的产品管理工作流图，包含固定骨架：
 * parse_user_input -> request_agent -> orchestrator_agent -> planner_agent（计划回放） -> executor_router -> executor-* -> executor_aggregator -> END。
 * 通过 Router 条件边和 Executor 节点内部任务选择实现 DAG 的动态规划与执行。
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

import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type {
  ExecutorAgentResult,
  OrchestratorContextSource,
  ProductKnowledgeGraph,
  ProductWorkflowResult,
  RequestAnalysis,
  TaskExecutionPlan,
  ModelUsageProfile,
} from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";
import type { ProductWorkflowStreamEvent } from "../agents/product-workflow/agent";
import type {
  WorkflowPurpose,
  WorkflowResumeContext,
} from "../agents/product-workflow/types";
import {
  aiShippingExecutorNode,
  dataAnalyticsExecutorNode,
  executorAggregatorNode,
  executorRouterNode,
  gtmExecutorNode,
  interfaceCraftExecutorNode,
  marketResearchExecutorNode,
  marketingGrowthExecutorNode,
  orchestratorAgentNode,
  productDiscoveryExecutorNode,
  plannerAgentNode,
  productExecutionExecutorNode,
  productStrategyExecutorNode,
  selectNextExecutorRouterTargets,
  toolkitExecutorNode,
} from "./nodes/product-workflow-node";
import { parseUserInputNode, requestAgentNode } from "./nodes/request-node";
import { WorkflowGraphState, type WorkflowGraphStateValue } from "./state";
import { getWorkflowCheckpointer } from "./workflow-checkpointer";

export interface WorkflowGraphInput {
  /** 服务端可信工作流用途；checkpoint 恢复时由图状态继续持有。 */
  workflowPurpose?: WorkflowPurpose;
  /** API 在本次请求或恢复前重新解析的会话当前模型快照。 */
  modelProfile?: ModelUsageProfile;
  workspaceId?: string;
  productContext?: string;
  contextSource?: OrchestratorContextSource;
  knowledgeGraph?: ProductKnowledgeGraph | null;
  userInputBlock: string;
  workflowThreadId?: string;
  resumeFromCheckpoint?: boolean;
  resumeContext?: WorkflowResumeContext;
  retryFailure?: {
    taskId: string;
    error: string;
  };
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
 * Executor Router 可继续路由的 LangGraph 目标集合。
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
  orchestrator_agent: "orchestrator_agent",
  planner_agent: "planner_agent",
  end: END,
} as const;

/**
 * Meta PM Agent 的 LangGraph 主图，负责从用户输入整理到产品工作流的阶段规划。
 */
export const graph = createWorkflowGraph(new MemorySaver());

let durableGraphPromise: Promise<typeof graph> | null = null;

/**
 * 创建 Meta PM Agent 的 LangGraph 主图。
 */
function createWorkflowGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(WorkflowGraphState)
  // 将 Conversation Agent 的 <user-input> block 转成结构化输入。
  .addNode("parse_user_input", parseUserInputNode)
  // Request Agent 负责对用户输入进行业务建模分类。
  .addNode("request_agent", requestAgentNode)
  // Orchestrator Agent 负责产品意图路由、上下文来源判断和生命周期调度。
  .addNode("orchestrator_agent", orchestratorAgentNode)
  // 兼容节点负责回放 Orchestrator 内 Planner SubAgent 已生成的 DAG。
  .addNode("planner_agent", plannerAgentNode)
  // Router 在固定图内根据 Planner DAG 动态选择下一批 Executor 分支。
  .addNode("executor_router", executorRouterNode)
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
  // Aggregator 汇合同一批 Executor 写入的状态，再把调度权交回 Router。
  .addNode("executor_aggregator", executorAggregatorNode)

  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addEdge("request_agent", "orchestrator_agent")
  .addConditionalEdges("orchestrator_agent", selectNextNodeAfterOrchestrator, {
    planner_agent: "planner_agent",
    end: END,
  })
  .addEdge("planner_agent", "executor_router")
  .addConditionalEdges(
    "executor_router",
    selectNextExecutorRouterTargets,
    PRODUCT_WORKFLOW_ROUTE_TARGETS,
  )
  .addEdge("executor-product-strategy", "executor_aggregator")
  .addEdge("executor-market-research", "executor_aggregator")
  .addEdge("executor-gtm", "executor_aggregator")
  .addEdge("executor-product-discovery", "executor_aggregator")
  .addEdge("executor-product-execution", "executor_aggregator")
  .addEdge("executor-marketing-growth", "executor_aggregator")
  .addEdge("executor-data-analytics", "executor_aggregator")
  .addEdge("executor-ai-shipping", "executor_aggregator")
  .addEdge("executor-toolkit", "executor_aggregator")
  .addEdge("executor-interface-craft", "executor_aggregator")
  .addEdge("executor_aggregator", "executor_router")
  .compile({ checkpointer });
}

/**
 * 获取带持久化 checkpointer 的产品工作流图。
 */
async function getDurableWorkflowGraph(): Promise<typeof graph> {
  durableGraphPromise ??= getWorkflowCheckpointer().then((checkpointer) =>
    createWorkflowGraph(checkpointer),
  );
  return durableGraphPromise;
}

/**
 * 运行完整 LangGraph 主图，适用于不需要 SSE 中间事件的调用场景。
 */
export async function runWorkflowGraph(
  input: WorkflowGraphInput,
): Promise<WorkflowGraphResult> {
  const workflowGraph = await getDurableWorkflowGraph();
  const result = await workflowGraph.invoke(
    createWorkflowInitialState(input),
    createWorkflowRunConfig(input, "values"),
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
  const workflowGraph = await getDurableWorkflowGraph();
  const stream = await workflowGraph.stream(
    input.resumeFromCheckpoint ? null : createWorkflowInitialState(input),
    createWorkflowRunConfig(input, "custom"),
  );

  for await (const event of stream) {
    yield event as WorkflowGraphStreamEvent;
  }
}

/**
 * 根据 Orchestrator Agent 的路由决策，决定是否进入 Planner SubAgent 计划回放节点。
 */
export function selectNextNodeAfterOrchestrator(
  state: WorkflowGraphStateValue,
) {
  if (state.productWorkflow) return "end";
  if (state.orchestratorDecision?.route !== "product_workflow") return "end";
  if (!state.plan) {
    throw new Error(
      "Orchestrator routed to product_workflow without a valid delegated Planner plan.",
    );
  }
  return "planner_agent";
}

/**
 * 根据普通输入或恢复上下文构造 LangGraph 初始状态。
 */
function createWorkflowInitialState(input: WorkflowGraphInput) {
  const resume = input.resumeContext;
  const plan = resume?.forceSupplementPlan ? null : resume?.plan ?? null;
  const rerunTaskIds = new Set(resume?.rerunTaskIds ?? []);
  const executorResults = resume?.forceSupplementPlan
    ? []
    : filterExecutorResultsForResume(
        resume?.executorResults ?? [],
        plan,
        rerunTaskIds,
      );

  return {
    workflowPurpose:
      resume?.workflowPurpose ?? input.workflowPurpose ?? "standard",
    productContext: input.productContext ?? "",
    contextSource: input.contextSource ?? "none",
    workspaceId: input.workspaceId,
    userInputBlock: resume?.userInputBlock ?? input.userInputBlock,
    originalUserInput: resume?.originalUserInput ?? [],
    requestAnalysis: resume?.requestAnalysis ?? null,
    orchestratorDecision: resume?.orchestratorDecision ?? null,
    plan,
    supplementAgentTypes: resume?.supplementAgentTypes ?? [],
    supplementSourceTaskIds: resume?.supplementSourceTaskIds ?? [],
    supplementAffectedTaskIds: resume?.supplementAffectedTaskIds ?? [],
    supplementRelatedNodeIds: resume?.supplementRelatedNodeIds ?? [],
    answeredOpenQuestionIds: resume?.answeredOpenQuestionIds ?? [],
    executorResults,
    knowledgeGraph: resume?.knowledgeGraph ?? input.knowledgeGraph ?? null,
    priorCritiqueIssues: collectPriorCritiqueIssues(resume?.productWorkflow),
    productWorkflow: null,
  };
}

/**
 * 从上一轮 Critique 结果提取未关闭问题，并按问题代码和来源任务去重。
 */
function collectPriorCritiqueIssues(
  productWorkflow?: ProductWorkflowResult | null,
) {
  const issues = [
    ...(productWorkflow?.review.issues ?? []),
    ...(productWorkflow?.knowledge_graph_review?.issues ?? []),
  ];
  return [
    ...new Map(
      issues.map((issue) => [
        `${issue.code}|${issue.task_id ?? ""}`,
        issue,
      ]),
    ).values(),
  ];
}

/**
 * 为 LangGraph 运行构造稳定线程配置，使中断后的同一轮对话可以从 checkpoint 恢复。
 */
function createWorkflowRunConfig(
  input: WorkflowGraphInput,
  streamMode: "custom" | "values",
) {
  if (input.resumeFromCheckpoint && !input.workflowThreadId) {
    throw new Error("Cannot resume workflow checkpoint without workflowThreadId.");
  }

  return {
    signal: input.signal,
    streamMode,
    durability: "sync" as const,
    configurable: {
      thread_id:
        input.workflowThreadId ??
        `workflow:local:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      ...(input.modelProfile ? { model_profile: input.modelProfile } : {}),
      ...(input.retryFailure
        ? {
            retry_task_id: input.retryFailure.taskId,
            retry_error: input.retryFailure.error,
          }
        : {}),
    },
  };
}

/**
 * 根据会话和 request form 构造主产品工作流的 LangGraph thread_id。
 */
export function createWorkflowThreadId({
  conversationId,
  requestFormId,
}: {
  conversationId?: string;
  requestFormId?: string;
}): string {
  return `workflow:${conversationId ?? "local"}:${requestFormId ?? "default"}`;
}

/**
 * 判断持久化 checkpoint 是否仍停留在指定未完成任务，避免客户端恢复错误的工作流。
 */
export async function hasRetryableWorkflowTaskCheckpoint({
  workflowThreadId,
  taskId,
}: {
  workflowThreadId: string;
  taskId: string;
}): Promise<boolean> {
  const workflowGraph = await getDurableWorkflowGraph();
  const snapshot = await workflowGraph.getState({
    configurable: { thread_id: workflowThreadId },
  });
  const state = snapshot.values as WorkflowGraphStateValue;
  const taskExists = state.plan?.tasks.some((task) => task.task_id === taskId);
  const taskCompleted = state.executorResults?.some(
    (result) => result.task_id === taskId,
  );

  return Boolean(taskExists && !taskCompleted && snapshot.next.length > 0);
}

/**
 * 恢复运行时移除受影响任务及其下游结果，保留其他 Executor 上下文以减少重跑。
 */
function filterExecutorResultsForResume(
  results: ExecutorAgentResult[],
  plan: TaskExecutionPlan | null,
  rerunTaskIds: Set<string>,
): ExecutorAgentResult[] {
  if (!plan || rerunTaskIds.size === 0) return results;

  const blocked = collectDownstreamTaskIds(plan, rerunTaskIds);
  return results.filter((result) => !blocked.has(result.task_id));
}

/**
 * 计算需要重跑的任务集合，包含直接受影响任务和依赖它们的下游任务。
 */
function collectDownstreamTaskIds(
  plan: TaskExecutionPlan,
  initialTaskIds: Set<string>,
): Set<string> {
  const affected = new Set(initialTaskIds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const task of plan.tasks) {
      if (affected.has(task.task_id)) continue;
      if (task.depends_on.some((taskId) => affected.has(taskId))) {
        affected.add(task.task_id);
        changed = true;
      }
    }
  }

  return affected;
}
