import {
  TaskExecutionPlanSchema,
  type BusinessModelItem,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import type {
  PlannerAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { EXECUTOR_DEFINITIONS } from "../executor-agent/definitions";
import { PLANNER_AGENT_PROMPT } from "./prompt";

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
    signal: input.signal,
  });
}

/**
 * 在 Planner Agent 不可用时生成稳定的六段式 DAG。
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
      nodes: taskSpecs.map(({ definition }) => definition.agentType),
      edges: taskSpecs.slice(1).map(({ definition }, index) => ({
        source: taskSpecs[index]!.definition.agentType,
        target: definition.agentType,
      })),
    },
    tasks: taskSpecs.map(({ definition, sequence }, index) => ({
      task_id: `task-${String(sequence).padStart(2, "0")}`,
      sequence,
      title: definition.displayName,
      description: definition.role,
      assigned_agent: definition.agentType,
      depends_on: index === 0 ? [] : [`task-${String(index).padStart(2, "0")}`],
      covered_business_model_indexes: coveredIndexes,
      expected_output: `Produce the minimum ${definition.focusLayer} layer graph delta and review notes.`,
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
 * 生成简短的业务模型摘要，供 Planner 回退计划使用。
 */
function summarizeBusinessModels(items: BusinessModelItem[]): string {
  if (items.length === 0) return "Request Agent 未识别到业务建模项。";
  return items.map((item) => item.user_goal).join("；");
}
