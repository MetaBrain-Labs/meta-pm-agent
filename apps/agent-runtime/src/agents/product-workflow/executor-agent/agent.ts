import {
  ExecutorAgentResultSchema,
  type ExecutorAgentResult,
  type TaskExecutionNode,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import type {
  ExecutorAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import {
  getExecutorDefinition,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "./definitions";
import { createExecutorAgentPrompt } from "./prompt";

/**
 * Executor Agent：按任务分配调用对应领域 Agent，形成图谱增量建议。
 */
export async function* streamExecutorAgent(
  input: ExecutorAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ExecutorAgentResult, void> {
  const definition = getExecutorDefinition(
    assertExecutorAgentType(input.task.assigned_agent),
  );

  return yield* runJsonAgent({
    agentType: definition.agentType,
    agentLabel: definition.displayName,
    name: `${definition.agentType}-agent`,
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: createExecutorAgentPrompt(definition),
    payload: {
      executor_profile: {
        agent_type: definition.agentType,
        domain: definition.domain,
        graph_role: definition.graphRole,
        allowed_entity_types: definition.allowedEntityTypes,
        allowed_relation_types: definition.allowedRelationTypes,
        skills: definition.skills,
      },
      product_context: input.productContext || "No product context provided.",
      task: input.task,
      plan: input.plan,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
      previous_results: input.previousResults,
    },
    schema: ExecutorAgentResultSchema,
    fallback: () => createFallbackExecutorResult(input.task),
    signal: input.signal,
  });
}

/**
 * 在 Executor Agent 不可用时生成可落库的最小结果。
 */
function createFallbackExecutorResult(
  task: TaskExecutionNode,
): ExecutorAgentResult {
  const definition = getExecutorDefinition(
    assertExecutorAgentType(task.assigned_agent),
  );
  const entityId = `${definition.agentType}-${task.sequence}`;

  return {
    task_id: task.task_id,
    agent_type: definition.agentType,
    focus_layer: definition.focusLayer,
    summary: `${definition.displayName} generated a minimum graph-native placeholder result for the ${definition.focusLayer} layer.`,
    entities: [
      {
        id: entityId,
        type: definition.focusLayer,
        name: task.title,
        description: task.description,
        source_task_id: task.task_id,
      },
    ],
    relations: [],
    decisions: [],
    risks: ["该结果来自 MVP 回退逻辑，需要用户或后续模型确认。"],
    open_questions: ["是否接受该层的初始建模方向？"],
    quality_result: {
      passed: true,
      notes: "MVP 回退结果满足最小结构化输出要求。",
    },
  };
}

/**
 * 保护运行时分派边界，避免 Planner 输出未知 Agent 类型时静默进入错误节点。
 */
function assertExecutorAgentType(agentType: string): ExecutorAgentType {
  if (isExecutorAgentType(agentType)) return agentType;
  throw new Error(`Unknown executor agent type: ${agentType}`);
}
