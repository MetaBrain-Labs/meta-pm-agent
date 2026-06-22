import {
  ProductDirectorWorkflowResultSchema,
  type ExecutorAgentResult,
  type ProductDirectorWorkflowResult,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import { createKnowledgeGraphFileHandle } from "../../common/knowledge-graph-file-tool";
import {
  createToolsForAgent,
  getKnowledgeGraphFileToolNames,
} from "../../common/tool-access";
import type {
  ProductDirectorReviewInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { PRODUCT_DIRECTOR_AGENT_PROMPT } from "./prompt";

/**
 * ProductDirector Agent：验收各 Executor 结果并生成待确认的产品上下文和图谱更新。
 */
export async function* streamProductDirectorReview(
  input: ProductDirectorReviewInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  ProductDirectorWorkflowResult,
  void
> {
  const fileHandle = createKnowledgeGraphFileHandle(
    input.knowledgeGraph.markdown,
    input.workspaceId,
  );
  const tools = createToolsForAgent(
    "product_director",
    getKnowledgeGraphFileToolNames(),
    { knowledgeGraphFile: fileHandle },
  );

  const result = yield* runJsonAgent({
    agentType: "product_director",
    agentLabel: "ProductDirector Agent",
    name: "product-director-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 8192,
    },
    systemPrompt: PRODUCT_DIRECTOR_AGENT_PROMPT,
    tools,
    payload: {
      product_context: input.productContext || "No product context provided.",
      request_analysis: input.requestAnalysis,
      product_knowledge_graph: input.knowledgeGraph,
      product_knowledge_graph_markdown: input.knowledgeGraph.markdown,
      planner: input.plan,
      executor_results: input.executorResults,
    },
    schema: ProductDirectorWorkflowResultSchema,
    fallback: () =>
      createFallbackWorkflowResult(
        input.plan,
        input.executorResults,
        input.knowledgeGraph.markdown,
      ),
    signal: input.signal,
  });

  return {
    ...result,
    knowledge_graph_update: {
      ...result.knowledge_graph_update,
      markdown: fileHandle.read(),
    },
  };
}

/**
 * 在 ProductDirector Agent 不可用时生成待用户确认的验收结果。
 */
function createFallbackWorkflowResult(
  plan: TaskExecutionPlan,
  executorResults: ExecutorAgentResult[],
  knowledgeGraphMarkdown: string,
): ProductDirectorWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: plan.request_summary,
    planner: plan,
    executor_results: executorResults,
    review: {
      accepted_task_ids: executorResults.map((item) => item.task_id),
      rejected_task_ids: [],
      notes: "ProductDirector Agent 使用 MVP 回退验收，所有结构化结果等待用户确认。",
    },
    product_context_update: [
      `请求摘要：${plan.request_summary}`,
      ...executorResults.map((item) => `${item.focus_layer}：${item.summary}`),
    ].join("\n"),
    knowledge_graph_update: {
      entities: executorResults.flatMap((item) => item.entities),
      relations: executorResults.flatMap((item) => item.relations),
      markdown: knowledgeGraphMarkdown,
      notes: ["最终知识图谱以 product_knowledge_graph_markdown 为准。"],
    },
    confirmation_message:
      "我已完成本轮 MVP 规划、执行和验收。请确认是否接受这些产品上下文与知识图谱更新；确认后再合并，退回则舍弃本轮更新。",
  };
}
