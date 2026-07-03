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
  type ProductWorkflowProposalQuestion,
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
      maxTokens: 10240,
    },
    systemPrompt: PLANNER_AGENT_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
    },
    schema: TaskExecutionPlanSchema,
    fallback: (reason) => createFallbackPlan(input, reason),
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
      maxTokens: 10240,
    },
    systemPrompt: PLANNER_WORKFLOW_REVIEW_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
      user_language: detectUserInputLanguage(input.userInput),
      product_knowledge_graph: input.knowledgeGraph,
      planner: input.plan,
      executor_results: input.executorResults,
    },
    schema: ProductWorkflowResultSchema,
    fallback: () =>
      createFallbackWorkflowResult(
        input.plan,
        input.executorResults,
        input.userInput,
      ),
    signal: input.signal,
  });

  return result;
}

const NORMALIZED_DAG_ASSUMPTION =
  "Planner DAG was normalized to keep only real graph-data dependencies and remove serial edges that only expressed presentation order.";

const FALLBACK_PLAN_ASSUMPTION =
  "Planner Agent used a deterministic graph-operation fallback DAG that preserves parallel executor layers and task-level quality checks.";

const FALLBACK_EXECUTOR_ORDER: ExecutorAgentType[] = [
  "executor-product-strategy",
  "executor-toolkit",
  "executor-market-research",
  "executor-product-discovery",
  "executor-gtm",
  "executor-data-analytics",
  "executor-product-execution",
  "executor-marketing-growth",
  "executor-ai-shipping",
  "executor-interface-craft",
];

/**
 * fallback 任务角色，用于区分普通领域任务和下游策略收敛任务。
 */
type FallbackTaskRole = "default" | "strategy-refinement";

/**
 * fallback DAG 的内部任务规格，先保存角色再统一生成 TaskExecutionNode。
 */
type FallbackTaskSpec = {
  definition: ExecutorAgentDefinition;
  sequence: number;
  taskId: string;
  role: FallbackTaskRole;
};

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
    covered_business_model_indexes: [
      ...new Set(task.covered_business_model_indexes),
    ],
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
    const isExplicitToolkitStrategyDependency =
      agentType === "executor-toolkit" &&
      dependencyAgent === "executor-product-strategy";
    const isStrategyRefinementDependency =
      isDownstreamStrategyRefinementTask(task, tasksByAgent) &&
      dependencyTask.sequence < task.sequence;

    if (
      isSameAgentPreviousTask ||
      isHardDependency ||
      isExplicitToolkitStrategyDependency ||
      isStrategyRefinementDependency
    ) {
      dependencies.add(dependencyTask.task_id);
    }
  }

  for (const dependencyAgent of hardDependencyAgents) {
    const upstreamTask = getLastTaskForAgentBefore(
      dependencyAgent,
      task,
      tasksByAgent,
    );
    if (upstreamTask && upstreamTask.task_id !== task.task_id) {
      dependencies.add(upstreamTask.task_id);
    }
  }

  return [...dependencies];
}

/**
 * 判断当前 Product Strategy 任务是否为下游证据收敛任务。
 *
 * 这类任务需要消费 AI Shipping、Execution、Analytics 等上游图谱输出形成 Decision，
 * 不能被普通并行归一化逻辑剥掉跨 Executor 依赖。
 */
function isDownstreamStrategyRefinementTask(
  task: TaskExecutionNode,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): boolean {
  const agentType = task.assigned_agent as ExecutorAgentType;
  if (agentType !== "executor-product-strategy") return false;

  return Boolean(getPreviousTaskForAgent(agentType, task, tasksByAgent));
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
 * 获取当前任务之前某个 Executor 的最后一个任务，避免未来收敛任务形成反向依赖。
 */
function getLastTaskForAgentBefore(
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
 * 在 Planner Agent 不可用时生成稳定的图谱操作 DAG。
 */
export function createFallbackPlan(
  input: PlannerAgentInput,
  reason: string,
): TaskExecutionPlan {
  const analysis = input.requestAnalysis;
  const coveredIndexes = analysis.business_model.map((item) => item.index);
  const selectedDefinitions = selectFallbackExecutorDefinitions(analysis);
  const selectedAgents = new Set(
    selectedDefinitions.map((definition) => definition.agentType),
  );
  const taskSpecs = createFallbackTaskSpecs(
    selectedDefinitions,
    shouldPlanFallbackStrategyRefinement(analysis, selectedAgents),
  );
  const primaryTaskIdByAgent = createFallbackPrimaryTaskIdByAgent(taskSpecs);
  const tasks = taskSpecs.map(({ definition, sequence, taskId, role }) => ({
    task_id: taskId,
    sequence,
    title: createFallbackTaskTitle(definition.agentType, role),
    description: createFallbackTaskDescription(definition, analysis, role),
    assigned_agent: definition.agentType,
    depends_on: getFallbackTaskDependencies(
      { definition, taskId, role },
      selectedAgents,
      primaryTaskIdByAgent,
    ),
    covered_business_model_indexes: [...coveredIndexes],
    expected_output: createFallbackExpectedOutput(definition, role),
    quality_check: {
      status: "pending" as const,
      criteria: createFallbackQualityCriteria(definition, role),
    },
  }));

  const plan: TaskExecutionPlan = {
    status: isSupplementPlanInput(input.userInput) ? "supplement" : "initial",
    request_summary: createFallbackRequestSummary(analysis),
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: tasks.flatMap((task) =>
        task.depends_on.map((dependency) => ({
          source: dependency,
          target: task.task_id,
        })),
      ),
    },
    tasks,
    assumptions: [
      FALLBACK_PLAN_ASSUMPTION,
      `Fallback reason: ${reason}.`,
      ...createFallbackUncertaintyAssumptions(analysis),
      "Only executors relevant to the request were selected; unresolved subjective gaps must be recorded as assumptions, risks, or open questions instead of blocking execution.",
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
  const requestText = createRequestAnalysisText(analysis);
  const selected = new Set<ExecutorAgentType>([
    "executor-product-strategy",
    "executor-product-discovery",
    "executor-product-execution",
  ]);

  if (matchesAny(requestText, getProductDesignKeywords())) {
    selected.add("executor-market-research");
    selected.add("executor-toolkit");
  }

  addExecutorWhenMatches(selected, requestText, "executor-market-research", [
    "market",
    "competitor",
    "research",
    "survey",
    "竞品",
    "市场",
    "调研",
    "用户研究",
    "benchmark",
    "competitive",
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
    "数据分析",
    "埋点",
    "度量",
    "实验",
    "看板",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-ai-shipping", [
    "ai",
    "llm",
    "agent",
    "model",
    "technical",
    "architecture",
    "real-time",
    "realtime",
    "sync",
    "websocket",
    "crdt",
    "ot",
    "multi-user editing",
    "collaborative editing",
    "技术",
    "架构",
    "模型",
    "智能体",
    "工程",
    "实时",
    "同步",
    "多人",
    "多人编辑",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-toolkit", [
    "policy",
    "compliance",
    "legal",
    "workflow",
    "mvp",
    "scope",
    "assumption",
    "security",
    "privacy",
    "permission",
    "access control",
    "合规",
    "政策",
    "法务",
    "流程",
    "范围",
    "假设",
    "安全",
    "隐私",
    "权限",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-interface-craft", [
    "ui",
    "ux",
    "interface",
    "screen",
    "prototype",
    "wireframe",
    "toolbar",
    "界面",
    "交互",
    "原型",
    "页面",
    "线框",
    "线框图",
    "工具栏",
  ]);

  if (
    matchesAny(requestText, ["full chain", "end-to-end", "全链路", "完整方案"])
  ) {
    EXECUTOR_DEFINITIONS.forEach((definition) =>
      selected.add(definition.agentType),
    );
  }

  if (
    isConceptOrFunctionalDesignRequest(requestText) &&
    !hasExplicitExecutionIntent(requestText)
  ) {
    selected.delete("executor-product-execution");
    selected.delete("executor-ai-shipping");
    selected.delete("executor-interface-craft");
  }

  // 技术选型闭环优先于泛化市场扫描，除非用户明确要求市场研究。
  if (
    shouldPrioritizeTechnicalSelectionRefinement(requestText) &&
    selected.has("executor-ai-shipping") &&
    !hasExplicitMarketResearchIntent(requestText)
  ) {
    selected.delete("executor-market-research");
  }

  return FALLBACK_EXECUTOR_ORDER.flatMap((agentType) => {
    const definition = EXECUTOR_DEFINITIONS.find(
      (item) => item.agentType === agentType,
    );
    return definition && selected.has(definition.agentType) ? [definition] : [];
  });
}

/**
 * 将 Request Agent 分析压缩为 fallback 关键词选择用文本。
 */
function createRequestAnalysisText(
  analysis: PlannerAgentInput["requestAnalysis"],
): string {
  return analysis.business_model
    .map((item) =>
      [
        item.user_goal,
        ...item.goal_constraints,
        ...item.missing_information.map((info) => info.description),
      ].join(" "),
    )
    .join(" ")
    .toLowerCase();
}

/**
 * 判断 fallback 是否需要保留市场研究 Executor。
 */
function hasExplicitMarketResearchIntent(requestText: string): boolean {
  return matchesAny(requestText, [
    "market research",
    "competitor",
    "competitive",
    "benchmark",
    "survey",
    "市场调研",
    "竞品",
    "竞争分析",
    "用户调研",
    "基准",
  ]);
}

/**
 * 判断请求是否明确需要技术选型或架构建议闭环。
 */
function shouldPrioritizeTechnicalSelectionRefinement(
  requestText: string,
): boolean {
  return matchesAny(requestText, [
    "technology selection",
    "technical selection",
    "technical recommendation",
    "architecture recommendation",
    "architecture choice",
    "architecture design",
    "technical design",
    "technical architecture",
    "技术选型",
    "技术建议",
    "技术方案",
    "技术架构",
    "架构建议",
    "架构方案",
  ]);
}

/**
 * 判断 fallback 计划是否需要追加 Product Strategy 技术决策收敛任务。
 */
function shouldPlanFallbackStrategyRefinement(
  analysis: PlannerAgentInput["requestAnalysis"],
  selectedAgents: Set<ExecutorAgentType>,
): boolean {
  return (
    selectedAgents.has("executor-product-strategy") &&
    selectedAgents.has("executor-ai-shipping") &&
    shouldPrioritizeTechnicalSelectionRefinement(
      createRequestAnalysisText(analysis),
    )
  );
}

/**
 * 生成 fallback 任务规格，必要时追加下游策略收敛任务。
 */
function createFallbackTaskSpecs(
  selectedDefinitions: ExecutorAgentDefinition[],
  includeStrategyRefinement: boolean,
): FallbackTaskSpec[] {
  const baseSpecs = selectedDefinitions.map((definition, index) => ({
    definition,
    sequence: index + 1,
    taskId: createTaskId(index + 1),
    role: "default" as const,
  }));

  if (!includeStrategyRefinement) return baseSpecs;

  const strategyDefinition = EXECUTOR_DEFINITIONS.find(
    (item) => item.agentType === "executor-product-strategy",
  );
  if (!strategyDefinition) return baseSpecs;

  return [
    ...baseSpecs,
    {
      definition: strategyDefinition,
      sequence: baseSpecs.length + 1,
      taskId: createTaskId(baseSpecs.length + 1),
      role: "strategy-refinement",
    },
  ];
}

/**
 * 记录每个 Executor 的首个 fallback 任务 ID，供依赖计算复用。
 */
function createFallbackPrimaryTaskIdByAgent(
  taskSpecs: FallbackTaskSpec[],
): Map<ExecutorAgentType, string> {
  const taskIdByAgent = new Map<ExecutorAgentType, string>();

  for (const spec of taskSpecs) {
    if (!taskIdByAgent.has(spec.definition.agentType)) {
      taskIdByAgent.set(spec.definition.agentType, spec.taskId);
    }
  }

  return taskIdByAgent;
}

/**
 * 识别需要更完整图谱启动链路的产品设计类请求。
 */
function getProductDesignKeywords(): string[] {
  return [
    "mvp",
    "product design",
    "design an",
    "design a",
    "roadmap",
    "requirements",
    "feature",
    "collaboration",
    "document",
    "tool",
    "workflow",
    "solution",
    "产品设计",
    "设计",
    "方案",
    "需求",
    "功能",
    "文档",
    "协同",
    "工具",
  ];
}

/**
 * 判断请求是否明确停留在方向、概念或功能设计阶段，避免 fallback 过早进入执行链路。
 */
function isConceptOrFunctionalDesignRequest(requestText: string): boolean {
  return matchesAny(requestText, [
    "concept",
    "functional design",
    "product direction",
    "discuss direction",
    "before deciding concrete outputs",
    "概念",
    "功能设计",
    "产品方向",
    "先讨论",
    "后续再确定",
    "不确定具体产出",
  ]);
}

/**
 * 判断用户是否明确要求执行、技术架构、原型或 UI 产出。
 */
function hasExplicitExecutionIntent(requestText: string): boolean {
  return matchesAny(requestText, [
    "implementation plan",
    "architecture design",
    "technical design",
    "design technical architecture",
    "component breakdown",
    "prototype",
    "ui design",
    "interface design",
    "build plan",
    "执行计划",
    "技术架构设计",
    "架构设计",
    "架构方案",
    "组件拆解",
    "原型",
    "界面设计",
    "ui设计",
    "落地方案",
  ]);
}

/**
 * 为 fallback DAG 生成真实图谱数据依赖。
 */
function getFallbackDependencyAgents(
  agentType: ExecutorAgentType,
  selectedAgents: Set<ExecutorAgentType>,
): ExecutorAgentType[] {
  switch (agentType) {
    case "executor-product-strategy":
      return [];
    case "executor-toolkit":
      return pickFirstSelectedAgent(selectedAgents, [
        "executor-product-strategy",
      ]);
    case "executor-market-research":
    case "executor-gtm":
    case "executor-data-analytics":
    case "executor-product-discovery":
      return pickFirstSelectedAgent(selectedAgents, [
        "executor-product-strategy",
      ]);
    case "executor-product-execution":
      return pickFirstSelectedAgent(selectedAgents, [
        "executor-product-discovery",
        "executor-product-strategy",
      ]);
    case "executor-marketing-growth":
      return pickFirstSelectedAgent(selectedAgents, [
        "executor-gtm",
        "executor-product-discovery",
        "executor-product-strategy",
      ]);
    case "executor-ai-shipping":
    case "executor-interface-craft":
      return pickFirstSelectedAgent(selectedAgents, [
        "executor-product-execution",
        "executor-product-discovery",
        "executor-product-strategy",
      ]);
    default:
      return [];
  }
}

/**
 * 生成单个 fallback 任务的真实图谱数据依赖。
 */
function getFallbackTaskDependencies(
  spec: {
    definition: ExecutorAgentDefinition;
    taskId: string;
    role: FallbackTaskRole;
  },
  selectedAgents: Set<ExecutorAgentType>,
  primaryTaskIdByAgent: Map<ExecutorAgentType, string>,
): string[] {
  if (spec.role === "strategy-refinement") {
    return [
      "executor-product-strategy",
      "executor-product-execution",
      "executor-ai-shipping",
      "executor-data-analytics",
    ].flatMap((agentType) => {
      const taskId = primaryTaskIdByAgent.get(agentType as ExecutorAgentType);
      return taskId && taskId !== spec.taskId ? [taskId] : [];
    });
  }

  return getFallbackDependencyAgents(
    spec.definition.agentType,
    selectedAgents,
  ).flatMap((agentType) => {
    const dependencyTaskId = primaryTaskIdByAgent.get(agentType);
    return dependencyTaskId ? [dependencyTaskId] : [];
  });
}

/**
 * 从候选上游中选择第一个已入选的 Executor。
 */
function pickFirstSelectedAgent(
  selectedAgents: Set<ExecutorAgentType>,
  candidates: ExecutorAgentType[],
): ExecutorAgentType[] {
  const match = candidates.find((candidate) => selectedAgents.has(candidate));
  return match ? [match] : [];
}

/**
 * 为 fallback 任务生成图谱操作标题。
 */
function createFallbackTaskTitle(
  agentType: ExecutorAgentType,
  role: FallbackTaskRole = "default",
): string {
  if (role === "strategy-refinement") {
    return "Converge evidence into a technology-selection decision";
  }

  switch (agentType) {
    case "executor-product-strategy":
      return "Establish goals, requirements, and decision candidates";
    case "executor-market-research":
      return "Add market evidence and requirement benchmarks";
    case "executor-gtm":
      return "Translate strategy into GTM decisions";
    case "executor-product-discovery":
      return "Create feature hypotheses and validation metrics";
    case "executor-product-execution":
      return "Decompose features into implementation components";
    case "executor-marketing-growth":
      return "Define growth metrics and decision chain";
    case "executor-data-analytics":
      return "Define measurement plan and metric gaps";
    case "executor-ai-shipping":
      return "Compare technical options and delivery risks";
    case "executor-toolkit":
      return "Create scope, assumptions, and guardrail artifacts";
    case "executor-interface-craft":
      return "Add UI craft constraints and UX evidence";
    default:
      return "Create graph-native product workflow updates";
  }
}

/**
 * 为 fallback 任务生成自包含描述，避免 Executor 只收到领域名称。
 */
function createFallbackTaskDescription(
  definition: ExecutorAgentDefinition,
  analysis: PlannerAgentInput["requestAnalysis"],
  role: FallbackTaskRole = "default",
): string {
  const requestContext = createFallbackRequestContext(analysis);

  if (role === "strategy-refinement") {
    return `${requestContext}. Consume technical Evidence and Component boundaries from upstream tasks to create a supported technology-selection Decision or an explicitly labeled decision candidate. Do not treat unverified option comparisons as confirmed facts; use Goal --Drives--> Decision, Evidence --Validates--> Decision, and Decision --Produces--> Requirement only when supported.`;
  }

  switch (definition.agentType) {
    case "executor-product-strategy":
      return `${requestContext}. Create only user-explicit Goal and Requirement nodes plus evidence-backed or clearly labeled decision candidates. Do not convert unknown scale, authentication, storage, integration, architecture, or history granularity into confirmed Requirements or Decisions.`;
    case "executor-market-research":
      return `${requestContext}. Add verified market Evidence or clearly labeled research-gap Custom records. Link Evidence only to Requirements or supported Decision candidates; do not present model memory as verified fact.`;
    case "executor-gtm":
      return `${requestContext}. Add only relevant GTM Requirements, Metrics, Evidence, or decision candidates. Confirm GTM Decisions only when user input, graph context, or verified Evidence supports them.`;
    case "executor-product-discovery":
      return `${requestContext}. Translate explicit Requirements into testable Feature nodes. Mark inferred management, permission, history, or collaboration-awareness capabilities as hypotheses, and use Feature --Satisfies--> Requirement. Do not decompose implementation components here.`;
    case "executor-product-execution":
      return `${requestContext}. Decompose selected Features into essential Component entities only when execution detail is needed. Use Component --Implements--> Feature and avoid duplicate count-filler Components.`;
    case "executor-marketing-growth":
      return `${requestContext}. Define growth Metrics, Requirements, or decision candidates only when adoption or retention is in scope. Keep Decisions evidence-backed.`;
    case "executor-data-analytics":
      return `${requestContext}. Define product-operability Metrics, measurement plans, and benchmark gaps only. Do not create Custom nodes or claim measured results, adoption metrics, or industry benchmarks without verifiable Evidence. Use Metric --Measures--> Feature or Requirement.`;
    case "executor-ai-shipping":
      return `${requestContext}. Compare technical option families, synchronization models, integration approaches, and delivery constraints. Do not lock libraries, protocols, vendors, or storage choices unless already chosen. Record source-backed trade-offs as Evidence and unsupported claims as research gaps.`;
    case "executor-toolkit":
      return `${requestContext}. After Strategy requirements exist, create compact Custom or Component guardrails for security, permissions, compliance, and workflow. Do not create Risk nodes; record unconfirmed compliance risk in Custom/Component descriptions, uncertainty, risks, or open questions.`;
    case "executor-interface-craft":
      return `${requestContext}. Add UI-facing Component constraints and UX Evidence only when interface craft is in scope. Use Component constraint --Constrains--> UI Component and Evidence --Validates--> Component constraint; Evidence must not be the source of Constrains.`;
    default:
      return `${requestContext}. Create graph-native updates within this executor's allowed entity and relation boundaries.`;
  }
}

/**
 * 生成紧凑上下文，避免 fallback 在每个任务里重复完整请求分析。
 */
function createFallbackRequestContext(
  analysis: PlannerAgentInput["requestAnalysis"],
): string {
  const goal = truncateText(summarizeBusinessModels(analysis.business_model), 180);
  const missing = summarizeMissingInformation(analysis.business_model);
  if (missing === "None provided.") return `Goal: ${goal}`;

  return `Goal: ${goal}; Uncertainty: ${truncateText(missing, 160)}`;
}

/**
 * 生成 fallback 请求摘要，避免模型失败时把长用户目标完整灌入 request_summary。
 */
function createFallbackRequestSummary(
  analysis: PlannerAgentInput["requestAnalysis"],
): string {
  return truncateText(summarizeBusinessModels(analysis.business_model), 100);
}

/**
 * 将 Request Agent 缺失信息保留到根级 assumptions，避免只藏在任务描述里。
 */
function createFallbackUncertaintyAssumptions(
  analysis: PlannerAgentInput["requestAnalysis"],
): string[] {
  const missing = summarizeMissingInformation(analysis.business_model);
  if (missing === "None provided.") return [];

  return [`Unresolved request gaps: ${truncateText(missing, 220)}`];
}

/**
 * 将 fallback 文本限制在较短长度内，避免兜底计划再次变成超长输出。
 */
function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

/**
 * 生成 fallback 任务的预期产出说明。
 */
function createFallbackExpectedOutput(
  definition: ExecutorAgentDefinition,
  role: FallbackTaskRole = "default",
): string {
  if (role === "strategy-refinement") {
    return "Technology Decision or decision candidate linked to upstream Evidence and Requirements.";
  }

  return `Allowed entities only: ${definition.allowedEntityTypes.join(
    ", ",
  )}. Include traceable relation updates.`;
}

/**
 * 生成 fallback 任务的验收标准。
 */
function createFallbackQualityCriteria(
  definition: ExecutorAgentDefinition,
  role: FallbackTaskRole = "default",
): string[] {
  if (role === "strategy-refinement") {
    return [
      "Consume upstream technical Evidence and Component boundaries.",
      "Create a supported Decision or explicitly labeled decision candidate.",
      "Do not promote unverified option comparisons into confirmed facts.",
      "Use approved explicit relation directions.",
    ];
  }

  return [
    `Use only allowed entity types: ${definition.allowedEntityTypes.join(", ")}.`,
    "Keep unresolved gaps as assumptions, risks, or open questions, not confirmed Decisions.",
    "Use approved explicit relation directions.",
    "Preserve traceability and avoid duplicate count-filler entities.",
  ];
}

/**
 * 判断 fallback 计划是否来自用户确认/补充表单。
 */
function isSupplementPlanInput(
  userInput: PlannerAgentInput["userInput"],
): boolean {
  return userInput.some((item) =>
    /\[form answers - (product-workflow-confirmation|.*-proposal-decision)\]/i.test(
      item.content,
    ),
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
  userInput: PlannerWorkflowReviewInput["userInput"],
): ProductWorkflowResult {
  const language = detectUserInputLanguage(userInput);
  const proposalQuestions = createFallbackProposalQuestions(
    executorResults,
    language,
  );

  return {
    status:
      proposalQuestions.length > 0 ? "pending_user_confirmation" : "completed",
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
    proposal_questions: proposalQuestions,
    confirmation_message:
      proposalQuestions.length > 0
        ? formatFallbackSupplementMessage(language)
        : formatFallbackCompletedMessage(language),
  };
}

/**
 * Planner Review 不可用时，把 Executor open question 降级为 textarea 问题，不做控件类型猜测。
 */
function createFallbackProposalQuestions(
  executorResults: ExecutorAgentResult[],
  language: "zh" | "en",
): ProductWorkflowResult["proposal_questions"] {
  const questions = new Map<string, ProductWorkflowProposalQuestion>();

  for (const result of executorResults) {
    result.open_questions.forEach((question, index) => {
      const label = formatFallbackOpenQuestionLabel(
        question.text,
        result.task_id,
        language,
      );
      const key = normalizeFallbackQuestionText(label);
      if (!key) return;

      const source = {
        source_task_id: result.task_id,
        source_agent: result.agent_type,
      };
      const priority = result.open_questions.length - index;
      const existing = questions.get(key);
      if (existing) {
        existing.sources = mergeFallbackQuestionSources([
          ...existing.sources,
          source,
        ]);
        existing.priority = Math.max(existing.priority, priority);
        return;
      }

      questions.set(key, {
        id: `${result.task_id}-${question.id || `slot-${index + 1}`}`,
        label,
        type: "textarea",
        required: true,
        placeholder:
          language === "zh"
            ? "请补充这个问题所需的事实、约束或偏好。"
            : "Add the facts, constraints, or preferences needed for this question.",
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        sources: [source],
        priority,
      });
    });
  }

  return [...questions.values()].sort(
    (left, right) => right.priority - left.priority,
  );
}

/**
 * fallback 阶段优先展示 Executor 写入的真实问题文本，只有异常空值才使用兜底文案。
 */
function formatFallbackOpenQuestionLabel(
  text: string,
  taskId: string,
  language: "zh" | "en",
): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;

  return language === "zh"
    ? `请补充 ${taskId} 需要确认的关键信息`
    : `Add the key information needed by ${taskId}.`;
}

/**
 * 归一化 fallback 问题文本，用于合并不同 Executor 提出的同一用户决策。
 */
function normalizeFallbackQuestionText(text: string): string {
  return text
    .trim()
    .replace(/[?？。.!！]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * 对 fallback 问题来源按 agent/task 去重。
 */
function mergeFallbackQuestionSources<
  T extends ProductWorkflowProposalQuestion["sources"][number],
>(sources: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const source of sources) {
    byKey.set(`${source.source_agent}:${source.source_task_id}`, source);
  }
  return [...byKey.values()];
}

/**
 * 根据用户原始输入粗略识别用户语言，用于 fallback 文案兜底。
 */
function detectUserInputLanguage(
  userInput: PlannerWorkflowReviewInput["userInput"],
): "zh" | "en" {
  const text = userInput.map((item) => item.content).join("\n");
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

/**
 * 生成 fallback 补充问题提示。
 */
function formatFallbackSupplementMessage(language: "zh" | "en"): string {
  return language === "zh"
    ? "Planner Agent 使用 fallback 汇总完成本轮规划，请先补充 Executor Agent 提出的关键问题。"
    : "Planner Agent completed this workflow with a fallback summary. Please answer the key questions raised by the Executor Agents.";
}

/**
 * 生成 fallback 默认完成提示。
 */
function formatFallbackCompletedMessage(language: "zh" | "en"): string {
  return language === "zh"
    ? "Planner Agent 使用 fallback 汇总完成本轮规划，当前结果默认确认并结束本轮流程。"
    : "Planner Agent completed this workflow with a fallback summary. The current result is accepted by default and this round is complete.";
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
  if (items.length === 0) {
    return "No business model item was identified by Request Agent.";
  }
  return items.map((item) => item.user_goal).join("; ");
}

/**
 * 生成缺失信息摘要，提醒 fallback Executor 不要静默假设关键事实。
 */
function summarizeMissingInformation(items: BusinessModelItem[]): string {
  const missingInformation = items.flatMap((item) =>
    item.missing_information.map(
      (info) =>
        `${info.index}. ${info.description} (importance ${info.importance})`,
    ),
  );

  return missingInformation.length > 0
    ? missingInformation.join("; ")
    : "None provided.";
}
