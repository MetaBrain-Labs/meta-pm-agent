/**
 * Planner SubAgent 构造与结果提取
 *
 * 定义 DeepAgents SubAgent 的构造逻辑（createPlannerSubagent）以及从 task 工具
 * 返回结果中提取、校验 TaskExecutionPlan 的完整流程。
 *
 * Responsibilities:
 * - createPlannerSubagent()：构造零工具权限的 Planner DeepAgent SubAgent
 * - extractPlanFromSubagentResult()：从 SubAgent 输出中解析并归一化 DAG
 * - resolveToolMessageContent()：归一化 DeepAgents ToolMessage 内容为可解析字符串
 */

import type { SubAgent } from "deepagents";
import {
  TaskExecutionPlanSchema,
  type TaskExecutionPlan,
  type ModelUsageProfile,
} from "@repo/shared";
import { createDeepAgentToolAllowlistMiddleware } from "../../../common/deep-agent-tool-policy";
import { createChatModel } from "../../../common/model";
import { resolveAgentModelSelection } from "../../../common/model-profile";
import { parseJsonObject } from "../../../../utils/json";
import type { OrchestratorAgentInput } from "../../types";
import type { ExecutorAgentType } from "../../executor-agent/definitions";
import { PLANNER_SUBAGENT_PROMPT } from "./prompt";
import {
  CONCEPT_FOUNDATION_NOTICE,
  normalizeTaskExecutionPlan,
  createFallbackPlan,
  isBroadProductDesignRequest,
  isConceptFoundationRequest,
} from "./plan";

const BROAD_PRODUCT_DESIGN_REQUIRED_AGENTS = [
  "executor-market-research",
  "executor-product-execution",
] as const;

/**
 * 创建 Planner 子代理；该子代理接收完整产品上下文并通过 task 描述返回 DAG JSON。
 * 子代理无工具权限，仅从 task 描述中读取上下文并返回结构化 JSON。
 */
export function createPlannerSubagent(
  modelProfile?: ModelUsageProfile,
): SubAgent {
  const subagentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "orchestrator-planner-subagent",
      allowedToolNames: [],
    });

  return {
    name: "planner",
    description:
      "Generates executable TaskExecutionPlan DAG from product request analysis and knowledge graph context. Returns JSON matching TaskExecutionPlanSchema.",
    systemPrompt: PLANNER_SUBAGENT_PROMPT,
    model: createChatModel(
      {
        enableThinking: true,
        responseFormat: "json_object",
        temperature: 0,
        maxTokens: 16_384,
        timeout: 120_000,
      },
      resolveAgentModelSelection(modelProfile, "planner"),
    ),
    tools: [],
    middleware: [subagentToolAllowlistMiddleware],
  };
}

/**
 * 从 Planner SubAgent 的 task 工具结果中提取并校验 TaskExecutionPlan。
 * 提取失败时回退到确定性 fallback DAG。
 */
export function extractPlanFromSubagentResult(
  rawResult: unknown,
  input: OrchestratorAgentInput,
): TaskExecutionPlan {
  if (rawResult === null || rawResult === undefined) {
    return finalizePlan(
      createFallbackPlan(input, "Planner subagent was not invoked or returned no output"),
      input,
    );
  }

  const content = resolveToolMessageContent(rawResult);
  if (content === null) {
    return finalizePlan(
      createFallbackPlan(input, "Planner subagent returned no parseable output"),
      input,
    );
  }

  const parsed = parseJsonObject(content);
  if (parsed === null) {
    return finalizePlan(
      createFallbackPlan(input, "Planner subagent output was not valid JSON"),
      input,
    );
  }

  const result = TaskExecutionPlanSchema.safeParse(parsed);
  if (result.success) {
    const candidate = input.supplementAgentTypes?.length
      ? scopeSupplementPlan(result.data, input.supplementAgentTypes)
      : scopeInitialDecisionPlan(result.data, input);
    if (candidate.tasks.length > 0) {
      if (isUnderScopedBroadProductDesign(candidate, input)) {
        return finalizePlan(
          createFallbackPlan(
            input,
            "Planner omitted required evidence-research or MVP-component coverage for a broad initial product-design request",
          ),
          input,
        );
      }
      return finalizePlan(candidate, input);
    }
  }

  return finalizePlan(
    createFallbackPlan(
      input,
      `Planner subagent output failed schema validation`,
    ),
    input,
  );
}

/**
 * 宽泛首轮必须同时落下可信证据和 MVP 组件验收任务，避免两节点概念图被误当完整设计。
 */
function isUnderScopedBroadProductDesign(
  plan: TaskExecutionPlan,
  input: OrchestratorAgentInput,
): boolean {
  if (
    plan.status !== "initial" ||
    !isBroadProductDesignRequest(input.requestAnalysis)
  ) {
    return false;
  }

  const assignedAgents = new Set(plan.tasks.map((task) => task.assigned_agent));
  return BROAD_PRODUCT_DESIGN_REQUIRED_AGENTS.some(
    (agentType) => !assignedAgents.has(agentType),
  );
}

/**
 * 统一归一化 Planner 输出，并移除已经由用户回答的阻塞问题。
 */
function finalizePlan(
  plan: TaskExecutionPlan,
  input: OrchestratorAgentInput,
): TaskExecutionPlan {
  return normalizeTaskExecutionPlan(
    removeAnsweredOpenQuestions(plan, input.answeredOpenQuestionIds),
  );
}

/**
 * 已由用户回答的问题不能在补充 DAG 中再次声明为待创建的阻塞问题。
 */
export function removeAnsweredOpenQuestions(
  plan: TaskExecutionPlan,
  answeredOpenQuestionIds: string[] = [],
): TaskExecutionPlan {
  if (plan.status !== "supplement" || answeredOpenQuestionIds.length === 0) {
    return plan;
  }

  const answeredIds = new Set(answeredOpenQuestionIds);
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      required_open_question_ids: (
        task.required_open_question_ids ?? []
      ).filter((id) => !answeredIds.has(id)),
    })),
  };
}

/**
 * 首轮仍有关键缺口时移除详细执行/UI拆分及其真实下游任务。
 */
export function scopeInitialDecisionPlan(
  plan: TaskExecutionPlan,
  input: OrchestratorAgentInput,
): TaskExecutionPlan {
  if (plan.status !== "initial") return plan;

  const conceptOnly = isConceptFoundationRequest(input.requestAnalysis);
  const hasMissingInformation = input.requestAnalysis.business_model.some(
    (item) => item.missing_information.length > 0,
  );
  const explicitlyRequestsExecution = input.userInput.some((item) =>
    /architecture design|technical design|component breakdown|prototype|架构设计|技术设计|组件拆解|原型/i.test(
      item.content,
    ),
  );
  if (
    !hasMissingInformation ||
    explicitlyRequestsExecution
  ) {
    return conceptOnly ? markConceptFoundation(plan) : plan;
  }

  const broadProductDesign = isBroadProductDesignRequest(input.requestAnalysis);
  const removedAgents = new Set(
    broadProductDesign
      ? ["executor-ai-shipping", "executor-interface-craft"]
      : [
          "executor-product-execution",
          "executor-ai-shipping",
          "executor-interface-craft",
        ],
  );
  const removedTaskIds = new Set(
    plan.tasks
      .filter((task) => removedAgents.has(task.assigned_agent))
      .map((task) => task.task_id),
  );

  // depends_on 表示真实数据依赖；上游被延后时，下游不能伪装成仍可执行。
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of plan.tasks) {
      if (
        !removedTaskIds.has(task.task_id) &&
        task.depends_on.some((taskId) => removedTaskIds.has(taskId))
      ) {
        removedTaskIds.add(task.task_id);
        changed = true;
      }
    }
  }

  const tasks = plan.tasks.filter((task) => !removedTaskIds.has(task.task_id));
  const scopedPlan = {
    ...plan,
    tasks,
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: tasks.flatMap((task) =>
        task.depends_on.map((source) => ({ source, target: task.task_id })),
      ),
    },
  };

  return conceptOnly ? markConceptFoundation(scopedPlan) : scopedPlan;
}

/**
 * 在用户可见的 Planner 摘要和假设中明确概念轮次的交付边界。
 */
function markConceptFoundation(plan: TaskExecutionPlan): TaskExecutionPlan {
  if (plan.assumptions.includes(CONCEPT_FOUNDATION_NOTICE)) return plan;
  return {
    ...plan,
    request_summary: plan.request_summary.includes(CONCEPT_FOUNDATION_NOTICE)
      ? plan.request_summary
      : `${CONCEPT_FOUNDATION_NOTICE} ${plan.request_summary}`,
    assumptions: [...plan.assumptions, CONCEPT_FOUNDATION_NOTICE],
  };
}

/**
 * 对模型生成的 supplement DAG 做确定性裁剪和重编号，避免重复执行第一轮任务。
 */
export function scopeSupplementPlan(
  plan: TaskExecutionPlan,
  allowedAgents: ExecutorAgentType[],
): TaskExecutionPlan {
  const allowed = new Set(allowedAgents);
  const selectedTasks = plan.tasks.filter((task) =>
    allowed.has(task.assigned_agent as ExecutorAgentType),
  );
  const taskIdMap = new Map(
    selectedTasks.map((task, index) => [
      task.task_id,
      `supplement-task-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const tasks = selectedTasks.map((task, index) => ({
    ...task,
    task_id: taskIdMap.get(task.task_id)!,
    sequence: index + 1,
    depends_on: task.depends_on.flatMap((taskId) => {
      const mapped = taskIdMap.get(taskId);
      return mapped ? [mapped] : [];
    }),
  }));

  return {
    ...plan,
    status: "supplement",
    tasks,
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: tasks.flatMap((task) =>
        task.depends_on.map((source) => ({
          source,
          target: task.task_id,
        })),
      ),
    },
  };
}

/**
 * 将 ToolMessage 的 content 归一化为可解析的字符串。
 * DeepAgents 可能返回 string、数组或嵌套对象。
 */
export function resolveToolMessageContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    // LangChain 复合内容块 {"type":"text","text":"..."} 格式
    if (first && typeof first === "object" && "text" in first) {
      return String((first as { text: unknown }).text);
    }
    return String(first);
  }
  if (raw && typeof raw === "object" && "text" in raw) {
    return String((raw as { text: unknown }).text);
  }
  return null;
}
