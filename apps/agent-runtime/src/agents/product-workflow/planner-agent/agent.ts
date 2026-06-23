import {
  ProductWorkflowResultSchema,
  TaskExecutionPlanSchema,
  type BusinessModelItem,
  type ExecutorAgentResult,
  type ProductWorkflowResult,
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
  PlannerWorkflowReviewInput,
  PlannerAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { EXECUTOR_DEFINITIONS } from "../executor-agent/definitions";
import {
  PLANNER_AGENT_PROMPT,
  PLANNER_WORKFLOW_REVIEW_PROMPT,
} from "./prompt";

/**
 * Planner Agent：把 Request Agent 的 business_model 转换为可执行 DAG。
 */
export async function* streamPlannerAgent(
  input: PlannerAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, TaskExecutionPlan, void> {
  return yield* runJsonAgent({
    agentType: "planner",
    agentLabel: "Planner Agent",
    name: "planner-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: PLANNER_AGENT_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
    },
    schema: TaskExecutionPlanSchema,
    fallback: () => createFallbackPlan(input.requestAnalysis),
    suppressInvalidJsonReasoning: true,
    signal: input.signal,
  });
}

/**
 * Planner Agent：在 Executor 全部完成后汇总工作流结果并生成用户确认数据。
 */
export async function* streamPlannerWorkflowReview(
  input: PlannerWorkflowReviewInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  ProductWorkflowResult,
  void
> {
  const fileHandle = createKnowledgeGraphFileHandle(
    input.knowledgeGraph.markdown,
    input.workspaceId,
  );
  const tools = createToolsForAgent(
    "planner",
    getKnowledgeGraphFileToolNames(),
    { knowledgeGraphFile: fileHandle },
  );

  const result = yield* runJsonAgent({
    agentType: "planner",
    agentLabel: "Planner Agent",
    name: "planner-agent-review",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 8192,
    },
    systemPrompt: PLANNER_WORKFLOW_REVIEW_PROMPT,
    tools,
    payload: {
      product_context: input.productContext || "No product context provided.",
      request_analysis: input.requestAnalysis,
      product_knowledge_graph: input.knowledgeGraph,
      product_knowledge_graph_markdown: input.knowledgeGraph.markdown,
      planner: input.plan,
      executor_results: input.executorResults,
    },
    schema: ProductWorkflowResultSchema,
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
 * 在 Planner Agent 不可用时生成稳定的十 Executor 图谱 DAG。
 */
function createFallbackPlan(
  analysis: PlannerAgentInput["requestAnalysis"],
): TaskExecutionPlan {
  const coveredIndexes = analysis.business_model.map((item) => item.index);
  const taskSpecs = EXECUTOR_DEFINITIONS.map((definition, index) => ({
    definition,
    sequence: index + 1,
  }));

  return {
    request_summary: summarizeBusinessModels(analysis.business_model),
    dag: {
      nodes: taskSpecs.map(({ sequence }) => createTaskId(sequence)),
      edges: taskSpecs.slice(1).map((_taskSpec, index) => ({
        source: createTaskId(index + 1),
        target: createTaskId(index + 2),
      })),
    },
    tasks: taskSpecs.map(({ definition, sequence }, index) => ({
      task_id: createTaskId(sequence),
      sequence,
      title: definition.displayName,
      description: definition.graphRole,
      assigned_agent: definition.agentType,
      depends_on: index === 0 ? [] : [createTaskId(index)],
      covered_business_model_indexes: coveredIndexes,
      expected_output: `Produce graph-native ${definition.allowedEntityTypes.join(", ")} updates with traceable relations.`,
      quality_check: {
        status: "pending",
        criteria: [
          "覆盖 Request Agent 的 business_model",
          "保留待用户确认的不确定信息",
        ],
      },
    })),
    assumptions: ["Planner Agent 使用 MVP 回退 DAG，后续可由模型动态调整。"],
  };
}

/**
 * Planner Agent 不可用时生成待用户确认的工作流汇总结果。
 */
function createFallbackWorkflowResult(
  plan: TaskExecutionPlan,
  executorResults: ExecutorAgentResult[],
  knowledgeGraphMarkdown: string,
): ProductWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: plan.request_summary,
    planner: plan,
    executor_results: executorResults,
    review: {
      accepted_task_ids: executorResults.map((item) => item.task_id),
      rejected_task_ids: [],
      notes: "Planner Agent 使用 MVP 回退汇总，所有结构化结果等待用户确认。",
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
      "我已完成本轮 MVP 规划、执行和汇总。请确认是否接受这些产品上下文与知识图谱更新；确认后再合并，退回则放弃本轮更新。",
  };
}

/**
 * 生成 Planner fallback DAG 中稳定的任务 ID。
 */
function createTaskId(sequence: number): string {
  return `task-${String(sequence).padStart(2, "0")}`;
}

/**
 * 生成简短的业务模型摘要，供 Planner 回退计划使用。
 */
function summarizeBusinessModels(items: BusinessModelItem[]): string {
  if (items.length === 0) return "Request Agent 未识别到业务建模项。";
  return items.map((item) => item.user_goal).join("；");
}
