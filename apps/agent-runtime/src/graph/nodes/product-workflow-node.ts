import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { ExecutorAgentResult } from "@repo/shared";
import type { ProductWorkflowStreamEvent } from "../../agents/product-workflow/agent";
import {
  EXECUTOR_DEFINITIONS,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "../../agents/product-workflow/executor-agent/definitions";
import {
  createProductWorkflowKnowledgeGraph,
  formatExecutorResultBlock,
  formatProductDirectorWorkflowBlock,
  formatTaskExecutionPlanBlock,
  streamExecutorAgent,
  streamPlannerAgent,
  streamProductDirectorReview,
} from "../../agents/product-workflow/agent";
import type { WorkflowGraphStateValue } from "../state";

/**
 * 执行 Planner Agent 节点，把 Request Agent 的分析结果转换为可执行 DAG。
 */
export async function plannerAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis) return {};

  const writer = getWriter(config);
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  const plan = await consumeProductWorkflowStream(
    streamPlannerAgent({
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      knowledgeGraph,
      signal: config?.signal,
    }),
    writer,
  );

  // Planner 的结构化 DAG 继续沿用现有 tagged block，供 API 落库和前端展示。
  writer?.({
    type: "agent-output",
    agentType: "planner",
    content: formatTaskExecutionPlanBlock(plan),
  });

  return { knowledgeGraph, plan };
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

  const result = await consumeProductWorkflowStream(
    streamExecutorAgent({
      task,
      plan: state.plan,
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      previousResults: state.executorResults,
      signal: config?.signal,
    }),
    writer,
  );
  const executorResults = [...state.executorResults, result];
  writer?.({
    type: "agent-output",
    agentType: result.agent_type,
    content: formatExecutorResultBlock(result),
  });

  return { executorResults };
}

/**
 * 执行 ProductDirector Agent 节点，验收 Planner 与 Executor 结果并生成待用户确认的更新。
 */
export async function productDirectorAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  const workflowResult = await consumeProductWorkflowStream(
    streamProductDirectorReview({
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      plan: state.plan,
      executorResults: state.executorResults,
      knowledgeGraph,
      signal: config?.signal,
    }),
    writer,
  );

  // ProductDirector 的完整验收结果用于持久化 request_form 和生成确认表单。
  writer?.({
    type: "agent-output",
    agentType: "product_director",
    content: formatProductDirectorWorkflowBlock(workflowResult),
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
): Promise<T> {
  let next = await stream.next();
  while (!next.done) {
    writer?.(next.value);
    next = await stream.next();
  }
  return next.value;
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
  return state.plan.tasks
    .filter((task) => task.assigned_agent === agentType)
    .sort((left, right) => left.sequence - right.sequence)
    .find((task) => {
      if (completedTaskIds.has(task.task_id)) return false;
      return task.depends_on.every((taskId) => completedTaskIds.has(taskId));
    }) ?? state.plan.tasks
      .filter(
        (task) =>
          task.assigned_agent === agentType &&
          !completedTaskIds.has(task.task_id),
      )
      .sort((left, right) => left.sequence - right.sequence)[0] ?? null;
}

/**
 * 根据 Planner DAG 和已完成结果选择下一个 LangGraph Executor 节点。
 */
export function selectNextProductWorkflowNode(
  state: WorkflowGraphStateValue,
): string {
  if (!state.plan) return "product_director_agent";

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  const incompleteTasks = state.plan.tasks
    .filter((task) => !completedTaskIds.has(task.task_id))
    .sort((left, right) => left.sequence - right.sequence);

  if (incompleteTasks.length === 0) return "product_director_agent";

  const readyTask =
    incompleteTasks.find((task) =>
      task.depends_on.every((taskId) => completedTaskIds.has(taskId)),
    ) ?? incompleteTasks[0];

  return isExecutorAgentType(readyTask.assigned_agent)
    ? readyTask.assigned_agent
    : "product_director_agent";
}
