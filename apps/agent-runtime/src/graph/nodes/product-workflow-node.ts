import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { ExecutorAgentResult } from "@repo/shared";
import type { ProductWorkflowStreamEvent } from "../../agents/product-workflow/agent";
import {
  createProductWorkflowKnowledgeGraph,
  formatExecutorResultBlock,
  formatProductDirectorWorkflowBlock,
  formatTaskExecutionPlanBlock,
  orderTasksBySequence,
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
 * 执行 Executor Agent 节点，按 Planner DAG 的线性顺序生成各领域图谱增量。
 */
export async function executorAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const executorResults: ExecutorAgentResult[] = [];

  // 当前 MVP 先按 sequence 串行执行，后续可在 LangGraph 内扩展为 Send fan-out。
  for (const task of orderTasksBySequence(state.plan.tasks)) {
    const result = await consumeProductWorkflowStream(
      streamExecutorAgent({
        task,
        plan: state.plan,
        productContext: state.productContext,
        requestAnalysis: state.requestAnalysis,
        userInput: state.userInput,
        previousResults: executorResults,
        signal: config?.signal,
      }),
      writer,
    );
    executorResults.push(result);
    writer?.({
      type: "agent-output",
      agentType: result.agent_type,
      content: formatExecutorResultBlock(result),
    });
  }

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
