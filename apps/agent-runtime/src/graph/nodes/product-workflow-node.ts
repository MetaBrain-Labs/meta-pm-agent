/**
 * 产品工作流图节点
 *
 * 实现 Planner Agent、Executor Router、Executor Aggregator、Critique Agent 阶段和全部 10 个 Executor Agent 的 LangGraph 节点。
 * Router 根据 Planner 生成的 DAG 动态选择下一批 Executor 分支，每个 Executor 节点按定义
 * 从 streamExecutorAgent 驱动并输出推理、工具调用和补丁结果。
 *
 * Responsibilities:
 * - 实现 plannerAgentNode：调用 Planner 生成 DAG，并在 Executor 全部完成后执行 Critique Agent
 * - 实现各 Executor 节点：读取知识图谱、执行任务、产出图谱补丁
 * - 实现 executorRouterNode / selectNextExecutorRouterTargets：按 DAG 依赖顺序调度下一批 Executor
 * - 实现 executorAggregatorNode：汇合同批 Executor 状态并发出知识图谱更新
 * - 管理 executorResults 累积和执行计划状态
 */

import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { TaskExecutionNode } from "@repo/shared";
import type { ProductWorkflowStreamEvent } from "../../agents/product-workflow/agent";
import {
  EXECUTOR_DEFINITIONS,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "../../agents/product-workflow/executor-agent/definitions";
import {
  createProductWorkflowKnowledgeGraph,
  appendKnowledgeGraphPatch,
  formatExecutorResultBlock,
  formatProductWorkflowBlock,
  formatTaskExecutionPlanBlock,
  streamExecutorAgent,
  streamOrchestratorAgent,
  streamCritiqueAgent,
  type OrchestratorAgentOutput,
} from "../../agents/product-workflow/agent";
import type { WorkflowGraphStateValue } from "../state";

/**
 * Planner 节点：显示 Orchestrator 的 Planner SubAgent 生成的 DAG，
 * 或在 checkpoint 恢复时重放已有的 Executor 结果。
 */
export async function plannerAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis) return {};
  if (state.plan) {
    const writer = getWriter(config);
    const isFreshPlan = state.executorResults.length === 0;

    // 新鲜计划（由 Orchestrator 的 Planner SubAgent 刚生成）已有完整生命周期事件，
    // 此处仅输出 Executor 回放结果；从 checkpoint 恢复的计划需完整状态事件。
    if (!isFreshPlan) {
      writer?.({
        type: "agent-status",
        agentType: "planner",
        status: "started",
        phase: "planning",
      });
    }
    writer?.({
      type: "agent-output",
      agentType: "planner",
      content: formatTaskExecutionPlanBlock(state.plan),
    });
    for (const result of state.executorResults) {
      writer?.({
        type: "agent-output",
        agentType: result.agent_type,
        content: formatExecutorResultBlock(result),
      });
    }
    if (!isFreshPlan) {
      writer?.({
        type: "agent-status",
        agentType: "planner",
        status: "completed",
        phase: "planning",
      });
    }

    return {
      knowledgeGraph:
        state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph(),
      plan: state.plan,
    };
  }

  // plan 缺失时不应发生（Orchestrator 始终生成 plan 或 fallback），直接透传现有图谱
  return {
    knowledgeGraph:
      state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph(),
  };
}

/**
 * 执行 Orchestrator Agent 节点，接管产品工作流路由、上下文来源判断、Planner DAG
 * 生成和收尾审查调度。
 */
export async function orchestratorAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || state.productWorkflow) return {};
  if (state.plan && arePlanTasksFinished(state)) {
    return executeCritiqueAgentReview(state, config);
  }
  if (state.orchestratorDecision) {
    return { orchestratorDecision: state.orchestratorDecision };
  }

  const writer = getWriter(config);
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();

  writer?.({
    type: "agent-status",
    agentType: "orchestrator",
    status: "started",
    phase: "planning",
  });
  const { decision, plan } = (await consumeProductWorkflowStream(
    streamOrchestratorAgent({
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      contextSource: state.contextSource,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      knowledgeGraph,
      signal: config?.signal,
    }),
    writer,
  )) as OrchestratorAgentOutput;
  writer?.({
    type: "reasoning",
    agentType: "orchestrator",
    content: `${decision.reason_summary}\n`,
  });
  writer?.({
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  });

  // Planner 生命周期事件（agent-status / agent-output）已由 streamOrchestratorAgent
  // 在 task 工具结果到达时通过 agentType "planner" 内嵌输出，此处不再重复。

  return { knowledgeGraph, orchestratorDecision: decision, plan };
}

/**
 * 为 LangGraph 注册 10 个独立 Executor Agent 节点名称。
 */
export const EXECUTOR_AGENT_NODE_NAMES = EXECUTOR_DEFINITIONS.map(
  (definition) => definition.agentType,
);

/**
 * 执行 Product Strategy Executor 节点。
 */
export const productStrategyExecutorNode = createExecutorAgentNode(
  "executor-product-strategy",
);

/**
 * 执行 Market Research Executor 节点。
 */
export const marketResearchExecutorNode = createExecutorAgentNode(
  "executor-market-research",
);

/**
 * 执行 Go-to-Market Executor 节点。
 */
export const gtmExecutorNode = createExecutorAgentNode("executor-gtm");

/**
 * 执行 Product Discovery Executor 节点。
 */
export const productDiscoveryExecutorNode = createExecutorAgentNode(
  "executor-product-discovery",
);

/**
 * 执行 Product Execution Executor 节点。
 */
export const productExecutionExecutorNode = createExecutorAgentNode(
  "executor-product-execution",
);

/**
 * 执行 Marketing Growth Executor 节点。
 */
export const marketingGrowthExecutorNode = createExecutorAgentNode(
  "executor-marketing-growth",
);

/**
 * 执行 Data Analytics Executor 节点。
 */
export const dataAnalyticsExecutorNode = createExecutorAgentNode(
  "executor-data-analytics",
);

/**
 * 执行 AI Shipping Executor 节点。
 */
export const aiShippingExecutorNode = createExecutorAgentNode(
  "executor-ai-shipping",
);

/**
 * 执行 Toolkit Executor 节点。
 */
export const toolkitExecutorNode = createExecutorAgentNode("executor-toolkit");

/**
 * 执行 Interface Craft Executor 节点。
 */
export const interfaceCraftExecutorNode = createExecutorAgentNode(
  "executor-interface-craft",
);

/**
 * 固定骨架中的 Executor Router 节点。
 *
 * 节点本身不修改状态，后续条件边会根据 Planner 生成的 DAG、已完成任务和最终汇总状态，
 * 动态选择下一批 Executor、回到 Critique Agent，或结束工作流。
 */
export async function executorRouterNode() {
  return {};
}

/**
 * 汇合同一批并行 Executor 的状态更新，并只在合并后归档知识图谱。
 */
export async function executorAggregatorNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  const writer = getWriter(config);
  if (state.knowledgeGraph) {
    writer?.({
      type: "knowledge-graph-update",
      knowledgeGraph: state.knowledgeGraph,
    });
  }

  return {};
}

/**
 * 兼容旧命名：历史上该节点承担并行批次屏障职责，现在语义上是固定骨架中的 Aggregator。
 */
export const executorBatchBarrierNode = executorAggregatorNode;

/**
 * 创建单个 Executor Agent 节点，按 Planner DAG 执行当前 Agent 的下一个就绪任务。
 */
function createExecutorAgentNode(agentType: ExecutorAgentType) {
  return async function executorAgentNode(
    state: WorkflowGraphStateValue,
    config?: LangGraphRunnableConfig,
  ) {
    return executeExecutorAgentTask(agentType, state, config);
  };
}

/**
 * 执行指定 Executor Agent 的单个就绪任务。
 */
async function executeExecutorAgentTask(
  agentType: ExecutorAgentType,
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const task = findNextExecutableTaskForAgent(state, agentType);
  if (!task) return {};
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  const parallelAgents = getCurrentParallelExecutorAgents(state);

  writer?.({
    type: "agent-status",
    agentType,
    status: "started",
    phase: "execution",
    parallelAgents,
  });

  const result = await consumeProductWorkflowStream(
    streamExecutorAgent({
      task,
      plan: state.plan,
      knowledgeGraph,
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      previousResults: state.executorResults,
      signal: config?.signal,
    }),
    writer,
    { parallelAgents },
  );
  const nextKnowledgeGraph = appendKnowledgeGraphPatch({
    knowledgeGraph,
    taskId: result.task_id,
    agentType: result.agent_type,
    entities: result.entities,
    relations: result.relations,
    decisions: result.decisions,
    risks: result.risks,
    openQuestions: result.open_questions,
    summary: [result.summary],
  });
  // Executor 只输出本任务结果，知识图谱归档交给批次 barrier 处理。
  writer?.({
    type: "agent-output",
    agentType: result.agent_type,
    content: formatExecutorResultBlock(result),
  });
  writer?.({
    type: "agent-status",
    agentType: result.agent_type,
    status: "completed",
    phase: "execution",
    parallelAgents,
  });

  return { executorResults: [result], knowledgeGraph: nextKnowledgeGraph };
}

/**
 * 执行 Critique Agent 收尾阶段，审查 Executor 结果并生成待用户确认的更新。
 */
async function executeCritiqueAgentReview(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  writer?.({
    type: "agent-status",
    agentType: "critique",
    status: "started",
    phase: "review",
  });
  const workflowResult = await consumeProductWorkflowStream(
    streamCritiqueAgent({
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      plan: state.plan,
      executorResults: state.executorResults,
      knowledgeGraph,
      signal: config?.signal,
    }),
    writer,
  );

  // Critique Agent 的完整审查结果用于持久化 request_form 和生成确认表单。
  writer?.({
    type: "agent-output",
    agentType: "critique",
    content: formatProductWorkflowBlock(workflowResult),
  });
  writer?.({
    type: "agent-status",
    agentType: "critique",
    status: "completed",
    phase: "review",
  });
  writer?.({ type: "complete", result: workflowResult });

  return { productWorkflow: workflowResult };
}

/**
 * 消费子 Agent 的流式事件，并保留 async generator 的最终结构化返回值。
 */
async function consumeProductWorkflowStream<T>(
  stream: AsyncGenerator<ProductWorkflowStreamEvent, T, void>,
  writer: ((chunk: unknown) => void) | undefined,
  options: { parallelAgents?: ExecutorAgentType[] } = {},
): Promise<T> {
  let next = await stream.next();
  while (!next.done) {
    writer?.(withParallelAgents(next.value, options.parallelAgents));
    next = await stream.next();
  }
  return next.value;
}

/**
 * 将当前并行批次信息补到 Executor token 事件，供前端 token 用量展示并行提示。
 */
function withParallelAgents(
  event: ProductWorkflowStreamEvent,
  parallelAgents?: ExecutorAgentType[],
): ProductWorkflowStreamEvent {
  if (
    event.type !== "token-usage" ||
    !parallelAgents ||
    parallelAgents.length <= 1
  ) {
    return event;
  }

  return {
    ...event,
    parallelAgents,
  };
}

/**
 * 找出指定 Executor Agent 当前可以执行的第一个 DAG 任务。
 */
function findNextExecutableTaskForAgent(
  state: WorkflowGraphStateValue,
  agentType: ExecutorAgentType,
) {
  if (!state.plan) return null;

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  return (
    state.plan.tasks
    .filter((task) => task.assigned_agent === agentType)
    .sort((left, right) => left.sequence - right.sequence)
    .find((task) => {
      if (completedTaskIds.has(task.task_id)) return false;
      return task.depends_on.every((taskId) => completedTaskIds.has(taskId));
    }) ?? null
  );
}

/**
 * 读取当前 Router 会同时调度的 Executor 集合，用于前端并行运行态展示。
 */
function getCurrentParallelExecutorAgents(
  state: WorkflowGraphStateValue,
): ExecutorAgentType[] {
  const targets = selectNextExecutorRouterTargets(state);
  if (!Array.isArray(targets)) return [];

  return targets.filter(isExecutorAgentType);
}

/**
 * 根据 Planner DAG 和已完成结果选择下一个 LangGraph Executor 节点。
 */
export function selectNextProductWorkflowNode(
  state: WorkflowGraphStateValue,
): string {
  const nextNodes = selectNextExecutorRouterTargets(state);
  return Array.isArray(nextNodes) ? nextNodes[0] ?? "end" : nextNodes;
}

/**
 * 根据 DAG 依赖选择下一批可并行运行的 Executor 节点。
 */
export function selectNextExecutorRouterTargets(
  state: WorkflowGraphStateValue,
): string | string[] {
  if (state.productWorkflow || !state.plan) return "end";

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  const incompleteTasks = state.plan.tasks
    .filter((task) => !completedTaskIds.has(task.task_id))
    .sort((left, right) => left.sequence - right.sequence);

  if (incompleteTasks.length === 0) return "orchestrator_agent";

  const readyTasks = incompleteTasks.filter((task) =>
    task.depends_on.every((taskId) => completedTaskIds.has(taskId)),
  );
  const parallelTasks = packParallelExecutorTasks(readyTasks);
  if (parallelTasks.length === 0) return "orchestrator_agent";

  return parallelTasks.map((task) => task.assigned_agent);
}

/**
 * 兼容旧命名：Executor Router 的条件边目标选择器。
 */
export const selectNextProductWorkflowNodes = selectNextExecutorRouterTargets;

/**
 * 判断 Planner DAG 中的任务是否已经全部由 Executor 回写结果。
 */
function arePlanTasksFinished(state: WorkflowGraphStateValue): boolean {
  if (!state.plan) return false;

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  return state.plan.tasks.every((task) => completedTaskIds.has(task.task_id));
}

/**
 * 同一批只保留每个 Executor 的最早任务，避免同一节点被重复调度。
 */
function packParallelExecutorTasks(
  tasks: TaskExecutionNode[],
): TaskExecutionNode[] {
  const selected = new Map<ExecutorAgentType, TaskExecutionNode>();

  for (const task of tasks.sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (!isExecutorAgentType(task.assigned_agent)) continue;
    if (selected.has(task.assigned_agent)) continue;
    selected.set(task.assigned_agent, task);
  }

  return [...selected.values()];
}
