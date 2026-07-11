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
} from "@repo/shared";
import { createDeepAgentToolAllowlistMiddleware } from "../../../common/deep-agent-tool-policy";
import { createChatModel } from "../../../common/model";
import { parseJsonObject } from "../../../../utils/json";
import type { OrchestratorAgentInput } from "../../types";
import type { ExecutorAgentType } from "../../executor-agent/definitions";
import { PLANNER_SUBAGENT_PROMPT } from "./prompt";
import {
  normalizeTaskExecutionPlan,
  createFallbackPlan,
} from "./plan";

/**
 * 创建 Planner 子代理；该子代理接收完整产品上下文并通过 task 描述返回 DAG JSON。
 * 子代理无工具权限，仅从 task 描述中读取上下文并返回结构化 JSON。
 */
export function createPlannerSubagent(): SubAgent {
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
    model: createChatModel({
      enableThinking: false,
      responseFormat: "json_object",
      temperature: 0,
      maxTokens: 16_384,
      timeout: 120_000,
    }),
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
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent was not invoked or returned no output"),
    );
  }

  const content = resolveToolMessageContent(rawResult);
  if (content === null) {
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent returned no parseable output"),
    );
  }

  const parsed = parseJsonObject(content);
  if (parsed === null) {
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent output was not valid JSON"),
    );
  }

  const result = TaskExecutionPlanSchema.safeParse(parsed);
  if (result.success) {
    const candidate = input.supplementAgentTypes?.length
      ? scopeSupplementPlan(result.data, input.supplementAgentTypes)
      : scopeInitialDecisionPlan(result.data, input);
    if (candidate.tasks.length > 0) {
      return normalizeTaskExecutionPlan(candidate);
    }
  }

  return normalizeTaskExecutionPlan(
    createFallbackPlan(
      input,
      `Planner subagent output failed schema validation`,
    ),
  );
}

/**
 * 首轮仍有关键缺口时移除详细执行/UI拆分，并把下游依赖回接到已保留上游任务。
 */
export function scopeInitialDecisionPlan(
  plan: TaskExecutionPlan,
  input: OrchestratorAgentInput,
): TaskExecutionPlan {
  const hasMissingInformation = input.requestAnalysis.business_model.some(
    (item) => item.missing_information.length > 0,
  );
  const explicitlyRequestsExecution = input.userInput.some((item) =>
    /architecture design|technical design|component breakdown|prototype|架构设计|技术设计|组件拆解|原型/i.test(
      item.content,
    ),
  );
  if (
    plan.status !== "initial" ||
    !hasMissingInformation ||
    explicitlyRequestsExecution
  ) {
    return plan;
  }

  const removedAgents = new Set([
    "executor-product-execution",
    "executor-interface-craft",
  ]);
  const taskById = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const tasks = plan.tasks
    .filter((task) => !removedAgents.has(task.assigned_agent))
    .map((task) => ({
      ...task,
      depends_on: [
        ...new Set(
          task.depends_on.flatMap((taskId) =>
            resolveRetainedDependencies(taskId, taskById, removedAgents),
          ),
        ),
      ],
    }));

  return {
    ...plan,
    tasks,
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: tasks.flatMap((task) =>
        task.depends_on.map((source) => ({ source, target: task.task_id })),
      ),
    },
  };
}

/**
 * 被移除任务只承载顺序时，递归寻找其真实上游依赖。
 */
function resolveRetainedDependencies(
  taskId: string,
  taskById: Map<string, TaskExecutionPlan["tasks"][number]>,
  removedAgents: Set<string>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(taskId)) return [];
  visited.add(taskId);
  const task = taskById.get(taskId);
  if (!task || !removedAgents.has(task.assigned_agent)) return task ? [taskId] : [];
  return task.depends_on.flatMap((dependency) =>
    resolveRetainedDependencies(dependency, taskById, removedAgents, visited),
  );
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
