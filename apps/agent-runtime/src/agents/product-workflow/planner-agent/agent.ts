/**
 * Planner Agent 实现
 *
 * 负责将 Request Agent 的 business_model 分析结果转换为可执行的 DAG 任务计划，
 * 并在所有 Executor 完成后汇总产出进行最终审查。
 *
 * Responsibilities:
 * - streamPlannerAgent()：生成 DAG 任务计划（基于 JSON DeepAgent）
 * - streamPlannerWorkflowReview()：汇总 Executor 产出并进行最终审查
 * - 为 Planner 附加知识图谱文件工具（kg_file_create/read/insert/update/delete_content）
 *
 * Notes:
 * - Planner 使用 runJsonAgent 通用执行器，输出 TaskExecutionPlan
 * - Planner Review 使用 runJsonAgent 执行器，输出 ProductWorkflowResult
 */

import {
  ProductWorkflowResultSchema,
  TaskExecutionPlanSchema,
  type BusinessModelItem,
  type ExecutorAgentResult,
  type ProductWorkflowResult,
  type TaskExecutionNode,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import type {
  PlannerWorkflowReviewInput,
  PlannerAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import {
  EXECUTOR_DEFINITIONS,
  type ExecutorAgentDefinition,
  type ExecutorAgentType,
} from "../executor-agent/definitions";
import { PLANNER_AGENT_PROMPT, PLANNER_WORKFLOW_REVIEW_PROMPT } from "./prompt";

/**
 * Planner Agent：把 Request Agent 的 business_model 转换为可执行 DAG。
 */
export async function* streamPlannerAgent(
  input: PlannerAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, TaskExecutionPlan, void> {
  const plan = yield* runJsonAgent({
    agentType: "planner",
    agentLabel: "Planner Agent",
    name: "planner-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 8192,
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

  return normalizeTaskExecutionPlan(plan);
}

/**
 * Planner Agent：在 Executor 全部完成后汇总工作流结果并生成用户确认数据。
 */
export async function* streamPlannerWorkflowReview(
  input: PlannerWorkflowReviewInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ProductWorkflowResult, void> {
  const result = yield* runJsonAgent({
    agentType: "planner",
    agentLabel: "Planner Agent",
    name: "planner-agent-review",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 9216,
    },
    systemPrompt: PLANNER_WORKFLOW_REVIEW_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      request_analysis: input.requestAnalysis,
      product_knowledge_graph: input.knowledgeGraph,
      planner: input.plan,
      executor_results: input.executorResults,
    },
    schema: ProductWorkflowResultSchema,
    fallback: () =>
      createFallbackWorkflowResult(input.plan, input.executorResults),
    signal: input.signal,
  });

  return result;
}

const NORMALIZED_DAG_ASSUMPTION =
  "Planner DAG 已归一化：仅保留真实图谱数据依赖，移除只表达展示顺序的串行边以支持并行 Executor 执行。";

/**
 * 归一化 Planner 生成的 Executor DAG。
 *
 * Planner 模型容易把“产品工作顺序”写成完整瀑布依赖链。这里将任务依赖收敛为真实
 * 图谱数据前置关系，并保留同一 Executor 的串行约束，确保 LangGraph 可以调度并行批次。
 */
export function normalizeTaskExecutionPlan(
  plan: TaskExecutionPlan,
): TaskExecutionPlan {
  const taskById = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const tasksByAgent = groupTasksByAgent(plan.tasks);
  const normalizedTasks = plan.tasks.map((task) => ({
    ...task,
    depends_on: normalizeTaskDependencies(task, taskById, tasksByAgent),
  }));
  const assumptions = plan.assumptions.includes(NORMALIZED_DAG_ASSUMPTION)
    ? plan.assumptions
    : [...plan.assumptions, NORMALIZED_DAG_ASSUMPTION];

  return {
    ...plan,
    dag: {
      nodes: normalizedTasks.map((task) => task.task_id),
      edges: normalizedTasks.flatMap((task) =>
        task.depends_on.map((dependency) => ({
          source: dependency,
          target: task.task_id,
        })),
      ),
    },
    tasks: normalizedTasks,
    assumptions,
  };
}

/**
 * 按 Executor Agent 聚合任务，供依赖归一化时寻找同领域前序任务。
 */
function groupTasksByAgent(
  tasks: TaskExecutionNode[],
): Map<ExecutorAgentType, TaskExecutionNode[]> {
  const groups = new Map<ExecutorAgentType, TaskExecutionNode[]>();

  for (const task of tasks) {
    const agentType = task.assigned_agent as ExecutorAgentType;
    const group = groups.get(agentType) ?? [];
    group.push(task);
    groups.set(agentType, group);
  }

  for (const group of groups.values()) {
    group.sort((left, right) => left.sequence - right.sequence);
  }

  return groups;
}

/**
 * 计算单个任务的真实依赖集合。
 */
function normalizeTaskDependencies(
  task: TaskExecutionNode,
  taskById: Map<string, TaskExecutionNode>,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): string[] {
  const agentType = task.assigned_agent as ExecutorAgentType;
  const hardDependencyAgents = getHardDependencyAgents(agentType, tasksByAgent);
  const dependencies = new Set<string>();

  // 同一个 Executor 的多个任务仍然串行，避免同一节点在一个并行批次内重复执行。
  const previousSameAgentTask = getPreviousTaskForAgent(
    agentType,
    task,
    tasksByAgent,
  );
  if (previousSameAgentTask) {
    dependencies.add(previousSameAgentTask.task_id);
  }

  // 对跨 Executor 依赖只保留真实的图谱数据前置关系。
  for (const dependencyId of task.depends_on) {
    const dependencyTask = taskById.get(dependencyId);
    if (!dependencyTask || dependencyTask.task_id === task.task_id) continue;

    const dependencyAgent = dependencyTask.assigned_agent as ExecutorAgentType;
    const isSameAgentPreviousTask =
      dependencyAgent === agentType && dependencyTask.sequence < task.sequence;
    const isHardDependency = hardDependencyAgents.includes(dependencyAgent);

    if (isSameAgentPreviousTask || isHardDependency) {
      dependencies.add(dependencyTask.task_id);
    }
  }

  for (const dependencyAgent of hardDependencyAgents) {
    const upstreamTask = getLastTaskForAgent(dependencyAgent, tasksByAgent);
    if (upstreamTask && upstreamTask.task_id !== task.task_id) {
      dependencies.add(upstreamTask.task_id);
    }
  }

  return [...dependencies];
}

/**
 * 定义 Executor 之间的硬数据依赖，而不是产品工作流展示顺序。
 */
function getHardDependencyAgents(
  agentType: ExecutorAgentType,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): ExecutorAgentType[] {
  const selectedAgents = new Set(tasksByAgent.keys());
  const include = (...agents: ExecutorAgentType[]) =>
    agents.filter((agent) => selectedAgents.has(agent));

  switch (agentType) {
    case "executor-product-strategy":
    case "executor-toolkit":
      return [];
    case "executor-market-research":
    case "executor-gtm":
    case "executor-data-analytics":
      return include("executor-product-strategy");
    case "executor-product-discovery":
      return include("executor-product-strategy");
    case "executor-product-execution":
      return include(
        "executor-product-discovery",
        "executor-product-strategy",
      ).slice(0, 1);
    case "executor-marketing-growth":
      return include(
        "executor-gtm",
        "executor-product-discovery",
        "executor-product-strategy",
      ).slice(0, 1);
    case "executor-ai-shipping":
    case "executor-interface-craft":
      return include(
        "executor-product-execution",
        "executor-product-discovery",
        "executor-product-strategy",
      ).slice(0, 1);
    default:
      return [];
  }
}

/**
 * 获取同一 Executor 在当前任务之前的最近任务。
 */
function getPreviousTaskForAgent(
  agentType: ExecutorAgentType,
  task: TaskExecutionNode,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): TaskExecutionNode | null {
  const tasks = tasksByAgent.get(agentType) ?? [];
  const previousTasks = tasks.filter(
    (candidate) => candidate.sequence < task.sequence,
  );

  return previousTasks.at(-1) ?? null;
}

/**
 * 获取某个 Executor 的最后一个任务，代表该 Executor 图谱输出已就绪。
 */
function getLastTaskForAgent(
  agentType: ExecutorAgentType,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): TaskExecutionNode | null {
  return tasksByAgent.get(agentType)?.at(-1) ?? null;
}

/**
 * 在 Planner Agent 不可用时生成稳定的十 Executor 图谱 DAG。
 */
function createFallbackPlan(
  analysis: PlannerAgentInput["requestAnalysis"],
): TaskExecutionPlan {
  const coveredIndexes = analysis.business_model.map((item) => item.index);
  const selectedDefinitions = selectFallbackExecutorDefinitions(analysis);
  const taskSpecs = selectedDefinitions.map((definition, index) => ({
    definition,
    sequence: index + 1,
  }));

  const plan: TaskExecutionPlan = {
    status: "initial",
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
    assumptions: [
      "Planner Agent 使用相关性回退 DAG，仅调度与当前请求最相关的 Executor。",
    ],
  };

  return normalizeTaskExecutionPlan(plan);
}

/**
 * 在 Planner 模型不可用时，根据请求关键词选择必要 Executor，避免默认跑满 10 个领域。
 */
function selectFallbackExecutorDefinitions(
  analysis: PlannerAgentInput["requestAnalysis"],
): ExecutorAgentDefinition[] {
  const requestText = analysis.business_model
    .map((item) =>
      [
        item.user_goal,
        ...item.goal_constraints,
        ...item.missing_information.map((info) => info.description),
      ].join(" "),
    )
    .join(" ")
    .toLowerCase();
  const selected = new Set<ExecutorAgentType>([
    "executor-product-strategy",
    "executor-product-discovery",
    "executor-product-execution",
  ]);

  addExecutorWhenMatches(selected, requestText, "executor-market-research", [
    "market",
    "competitor",
    "research",
    "survey",
    "竞品",
    "市场",
    "调研",
    "用户研究",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-gtm", [
    "gtm",
    "launch",
    "pricing",
    "sales",
    "channel",
    "上市",
    "定价",
    "渠道",
    "销售",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-marketing-growth", [
    "growth",
    "marketing",
    "activation",
    "retention",
    "增长",
    "营销",
    "留存",
    "转化",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-data-analytics", [
    "metric",
    "analytics",
    "experiment",
    "dashboard",
    "指标",
    "数据",
    "实验",
    "看板",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-ai-shipping", [
    "ai",
    "llm",
    "agent",
    "model",
    "technical",
    "技术",
    "模型",
    "智能体",
    "工程",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-toolkit", [
    "policy",
    "compliance",
    "legal",
    "workflow",
    "合规",
    "政策",
    "法务",
    "流程",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-interface-craft", [
    "ui",
    "ux",
    "interface",
    "screen",
    "prototype",
    "界面",
    "交互",
    "原型",
    "页面",
  ]);

  if (
    matchesAny(requestText, ["full chain", "end-to-end", "全链路", "完整方案"])
  ) {
    EXECUTOR_DEFINITIONS.forEach((definition) =>
      selected.add(definition.agentType),
    );
  }

  return EXECUTOR_DEFINITIONS.filter((definition) =>
    selected.has(definition.agentType),
  );
}

/**
 * 命中关键词时追加对应 Executor。
 */
function addExecutorWhenMatches(
  selected: Set<ExecutorAgentType>,
  requestText: string,
  agentType: ExecutorAgentType,
  keywords: string[],
): void {
  if (matchesAny(requestText, keywords)) {
    selected.add(agentType);
  }
}

/**
 * 判断请求文本是否包含任一相关性关键词。
 */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

/**
 * Planner Agent 不可用时生成待用户确认的工作流汇总结果。
 */
function createFallbackWorkflowResult(
  plan: TaskExecutionPlan,
  executorResults: ExecutorAgentResult[],
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
      decisions: executorResults.flatMap((item) => item.decisions),
      risks: executorResults.flatMap((item) => item.risks),
      open_questions: executorResults.flatMap((item) => item.open_questions),
      summary: executorResults.map((item) => item.summary),
      markdown: "",
      notes: ["最终知识图谱以结构化 JSON 为准。"],
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
