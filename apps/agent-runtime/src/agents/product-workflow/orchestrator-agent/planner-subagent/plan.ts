/**
 * Planner 规划引擎：DAG 归一化、Fallback 生成与格式化
 *
 * Planner SubAgent 的共享规划逻辑。normalizeTaskExecutionPlan 负责
 * 校验 LLM 生成的显式依赖边，createFallbackPlan 在模型不可用时生成确定性图谱操作 DAG。
 *
 * Responsibilities:
 * - normalizeTaskExecutionPlan()：归一化 Planner DAG，保留合法的显式图谱数据依赖
 * - createFallbackPlan()：模型不可用时的确定性 DAG 生成（关键词匹配 + 固定顺序）
 * - formatTaskExecutionPlanBlock()：前端 DAG 展示格式化
 */

import {
  TaskExecutionPlanSchema,
  type BusinessModelItem,
  type TaskExecutionNode,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  EXECUTOR_DEFINITIONS,
  type ExecutorAgentDefinition,
  type ExecutorAgentType,
} from "../../executor-agent/definitions";
import type { PlannerAgentInput } from "../../types";

// ---------------------------------------------------------------------------
// DAG 归一化
// ---------------------------------------------------------------------------

const NORMALIZED_DAG_ASSUMPTION =
  "Planner DAG dependencies were validated and deduplicated without removing explicit upstream data requirements.";
export const CONCEPT_FOUNDATION_NOTICE =
  "Concept foundation only; this is not a complete product design.";

/**
 * 归一化 Planner 生成的 Executor DAG。
 *
 * 显式依赖可能表达下游需要消费的实体 ID，运行时不得根据 Executor 类型擅自删除。
 * 这里只删除不存在、自引用或未来任务依赖，并保留同一 Executor 的串行约束。
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

function normalizeTaskDependencies(
  task: TaskExecutionNode,
  taskById: Map<string, TaskExecutionNode>,
  tasksByAgent: Map<ExecutorAgentType, TaskExecutionNode[]>,
): string[] {
  const agentType = task.assigned_agent as ExecutorAgentType;
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

  // 保留 Planner 明确给出的历史任务依赖；描述和验收标准可能消费其实体 ID。
  for (const dependencyId of task.depends_on) {
    const dependencyTask = taskById.get(dependencyId);
    if (
      dependencyTask &&
      dependencyTask.task_id !== task.task_id &&
      dependencyTask.sequence < task.sequence
    ) {
      dependencies.add(dependencyTask.task_id);
    }
  }

  return [...dependencies];
}

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


// ---------------------------------------------------------------------------
// Fallback DAG 生成
// ---------------------------------------------------------------------------

const FALLBACK_PLAN_ASSUMPTION =
  "Planner SubAgent used a deterministic graph-operation fallback DAG that preserves parallel executor layers and task-level quality checks.";

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

type FallbackTaskRole = "default" | "strategy-refinement";
type FallbackTaskSpec = {
  definition: ExecutorAgentDefinition;
  sequence: number;
  taskId: string;
  role: FallbackTaskRole;
};

/**
 * 在 Planner SubAgent 不可用时生成稳定的图谱操作 DAG。
 */
export function createFallbackPlan(
  input: PlannerAgentInput,
  reason: string,
): TaskExecutionPlan {
  const analysis = input.requestAnalysis;
  const coveredIndexes = analysis.business_model.map((item) => item.index);
  const isSupplement = isSupplementPlanInput(input);
  const selectedDefinitions = isSupplement
    ? selectSupplementExecutorDefinitions(input.supplementAgentTypes)
    : selectFallbackExecutorDefinitions(analysis);
  const selectedAgents = new Set(
    selectedDefinitions.map((definition) => definition.agentType),
  );
  const taskSpecs = createFallbackTaskSpecs(
    selectedDefinitions,
    !isSupplement &&
      shouldPlanFallbackStrategyRefinement(analysis, selectedAgents),
    isSupplement,
  );
  const primaryTaskIdByAgent = createFallbackPrimaryTaskIdByAgent(taskSpecs);
  const requiredOpenQuestionCount = isSupplement
    ? 0
    : analysis.business_model.reduce(
        (count, item) => count + item.missing_information.length,
        0,
      );
  const openQuestionOwnerTaskId =
    primaryTaskIdByAgent.get("executor-product-strategy") ??
    taskSpecs[0]?.taskId;
  const tasks = taskSpecs.map(({ definition, sequence, taskId, role }) => ({
    task_id: taskId,
    sequence,
    title: createFallbackTaskTitle(definition.agentType, role, isSupplement),
    description: createFallbackTaskDescription(
      definition,
      analysis,
      role,
      isSupplement,
    ),
    assigned_agent: definition.agentType,
    depends_on: getFallbackTaskDependencies(
      { definition, taskId, role },
      selectedAgents,
      primaryTaskIdByAgent,
    ),
    covered_business_model_indexes: [...coveredIndexes],
    expected_output: createFallbackExpectedOutput(definition, role),
    required_open_question_count:
      taskId === openQuestionOwnerTaskId ? requiredOpenQuestionCount : 0,
    quality_check: {
      status: "pending" as const,
      criteria: createFallbackQualityCriteria(definition, role),
    },
  }));

  const plan: TaskExecutionPlan = {
    status: isSupplement ? "supplement" : "initial",
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
 * supplement fallback 只保留 Critique 问题来源对应的 Executor；缺失来源时仅回退到 Strategy。
 */
function selectSupplementExecutorDefinitions(
  agentTypes: PlannerAgentInput["supplementAgentTypes"],
): ExecutorAgentDefinition[] {
  const selected = new Set(
    agentTypes?.length ? agentTypes : ["executor-product-strategy"],
  );
  return FALLBACK_EXECUTOR_ORDER.flatMap((agentType) => {
    const definition = EXECUTOR_DEFINITIONS.find(
      (item) => item.agentType === agentType,
    );
    return definition && selected.has(agentType) ? [definition] : [];
  });
}

function selectFallbackExecutorDefinitions(
  analysis: PlannerAgentInput["requestAnalysis"],
): ExecutorAgentDefinition[] {
  const requestText = createRequestAnalysisText(analysis);
  const isBroadProductDesign = isBroadProductDesignRequest(analysis);
  const selected = new Set<ExecutorAgentType>([
    "executor-product-strategy",
    "executor-product-discovery",
  ]);

  if (isBroadProductDesign) {
    selected.add("executor-market-research");
    selected.add("executor-product-execution");
  }

  addExecutorWhenMatches(selected, requestText, "executor-market-research", [
    "market", "competitor", "research", "survey", "竞品", "市场", "调研",
    "用户研究", "benchmark", "competitive",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-gtm", [
    "gtm", "launch", "pricing", "sales", "channel", "上市", "定价", "渠道", "销售",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-marketing-growth", [
    "growth", "marketing", "activation", "retention", "增长", "营销", "留存", "转化",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-data-analytics", [
    "metric", "analytics", "experiment", "dashboard", "指标", "数据分析",
    "埋点", "度量", "实验", "看板",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-ai-shipping", [
    "ai", "llm", "agent", "model", "technical", "architecture", "real-time",
    "realtime", "sync", "websocket", "crdt", "ot", "multi-user editing",
    "collaborative editing", "技术", "架构", "模型", "智能体", "工程", "实时",
    "同步", "多人", "多人编辑",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-toolkit", [
    "policy", "compliance", "legal", "workflow", "mvp", "scope", "assumption",
    "security", "privacy", "permission", "access control", "合规", "政策",
    "法务", "流程", "范围", "假设", "安全", "隐私", "权限",
  ]);
  addExecutorWhenMatches(selected, requestText, "executor-interface-craft", [
    "ui design", "ux design", "user interface", "interface design", "screen",
    "prototype", "wireframe", "toolbar", "界面", "交互", "原型", "页面", "线框",
    "线框图", "工具栏",
  ]);

  if (matchesAny(requestText, ["full chain", "end-to-end", "全链路", "完整方案"])) {
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

  if (
    analysis.business_model.some((item) => item.missing_information.length > 0) &&
    !hasExplicitExecutionIntent(requestText)
  ) {
    if (!isBroadProductDesign) {
      selected.delete("executor-product-execution");
    }
    selected.delete("executor-ai-shipping");
    selected.delete("executor-interface-craft");
  }

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

function hasExplicitMarketResearchIntent(requestText: string): boolean {
  return matchesAny(requestText, [
    "market research", "competitor", "competitive", "benchmark", "survey",
    "市场调研", "竞品", "竞争分析", "用户调研", "基准",
  ]);
}

function shouldPrioritizeTechnicalSelectionRefinement(
  requestText: string,
): boolean {
  return matchesAny(requestText, [
    "technology selection", "technical selection", "technical recommendation",
    "architecture recommendation", "architecture choice", "architecture design",
    "technical design", "technical architecture", "技术选型", "技术建议",
    "技术方案", "技术架构", "架构建议", "架构方案",
  ]);
}

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

function createFallbackTaskSpecs(
  selectedDefinitions: ExecutorAgentDefinition[],
  includeStrategyRefinement: boolean,
  isSupplement = false,
): FallbackTaskSpec[] {
  const baseSpecs = selectedDefinitions.map((definition, index) => ({
    definition,
    sequence: index + 1,
    taskId: `${isSupplement ? "supplement-" : ""}${createTaskId(index + 1)}`,
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
 * 判断当前请求是否是需要形成可执行产品设计的宽泛首轮，而非仅讨论概念。
 */
export function isBroadProductDesignRequest(
  analysis: PlannerAgentInput["requestAnalysis"],
): boolean {
  const requestText = createRequestAnalysisText(analysis);
  return (
    matchesAny(requestText, [
      "mvp",
      "product design",
      "design an",
      "design a",
      "roadmap",
      "设计",
      "方案",
    ]) &&
    matchesAny(requestText, [
      "product",
      "tool",
      "app",
      "platform",
      "workflow",
      "产品",
      "工具",
      "应用",
      "平台",
      "系统",
    ]) &&
    !isConceptOrFunctionalDesignRequest(requestText)
  );
}

/**
 * 判断用户是否明确把当前轮次限制为概念或方向讨论。
 */
export function isConceptFoundationRequest(
  analysis: PlannerAgentInput["requestAnalysis"],
): boolean {
  return isConceptOrFunctionalDesignRequest(createRequestAnalysisText(analysis));
}

function isConceptOrFunctionalDesignRequest(requestText: string): boolean {
  return matchesAny(requestText, [
    "concept", "functional design", "product direction", "discuss direction",
    "before deciding concrete outputs", "概念", "功能设计", "产品方向", "先讨论",
    "后续再确定", "不确定具体产出",
  ]);
}

function hasExplicitExecutionIntent(requestText: string): boolean {
  return matchesAny(requestText, [
    "implementation plan", "architecture design", "technical design",
    "design technical architecture", "component breakdown", "prototype",
    "ui design", "interface design", "build plan", "执行计划", "技术架构设计",
    "架构设计", "架构方案", "组件拆解", "原型", "界面设计", "ui设计", "落地方案",
  ]);
}

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

function getFallbackTaskDependencies(
  spec: { definition: ExecutorAgentDefinition; taskId: string; role: FallbackTaskRole },
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

function pickFirstSelectedAgent(
  selectedAgents: Set<ExecutorAgentType>,
  candidates: ExecutorAgentType[],
): ExecutorAgentType[] {
  const match = candidates.find((candidate) => selectedAgents.has(candidate));
  return match ? [match] : [];
}

function createFallbackTaskTitle(
  agentType: ExecutorAgentType,
  role: FallbackTaskRole = "default",
  isSupplement = false,
): string {
  if (role === "strategy-refinement") {
    return "Converge evidence into a technology-selection decision";
  }

  const title = (() => {
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
  })();
  return isSupplement ? `Apply confirmed answers: ${title}` : title;
}

function createFallbackTaskDescription(
  definition: ExecutorAgentDefinition,
  analysis: PlannerAgentInput["requestAnalysis"],
  role: FallbackTaskRole = "default",
  isSupplement = false,
): string {
  const requestContext = createFallbackRequestContext(analysis);

  if (isSupplement) {
    return `${requestContext}. Apply only the supplied Question Form answers to this executor's affected graph area. Create uniquely identified refinements or supersession records; do not repeat the baseline DAG, recreate existing entities, or broaden scope beyond the confirmed answers. Stay within this executor's allowed entity and relation types.`;
  }

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

function createFallbackRequestContext(
  analysis: PlannerAgentInput["requestAnalysis"],
): string {
  const goal = truncateText(summarizeBusinessModels(analysis.business_model), 180);
  const missing = summarizeMissingInformation(analysis.business_model);
  if (missing === "None provided.") return `Goal: ${goal}`;

  return `Goal: ${goal}; Uncertainty: ${truncateText(missing, 160)}`;
}

function createFallbackRequestSummary(
  analysis: PlannerAgentInput["requestAnalysis"],
): string {
  const summary = summarizeBusinessModels(analysis.business_model);
  return truncateText(
    isConceptFoundationRequest(analysis)
      ? `${CONCEPT_FOUNDATION_NOTICE} ${summary}`
      : summary,
    100,
  );
}

function createFallbackUncertaintyAssumptions(
  analysis: PlannerAgentInput["requestAnalysis"],
): string[] {
  const missing = summarizeMissingInformation(analysis.business_model);
  if (missing === "None provided.") return [];

  return [`Unresolved request gaps: ${truncateText(missing, 220)}`];
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function createFallbackExpectedOutput(
  definition: ExecutorAgentDefinition,
  role: FallbackTaskRole = "default",
): string {
  if (role === "strategy-refinement") {
    return "Technology Decision or decision candidate linked to upstream Evidence and Requirements.";
  }

  if (definition.agentType === "executor-market-research") {
    return "Source-verifiable Evidence and benchmark gaps linked to Requirements or decision candidates.";
  }
  if (definition.agentType === "executor-product-execution") {
    return "Minimum MVP Component breakdown linked to Features, with traceable acceptance Requirements or Metrics.";
  }

  return `Allowed entities only: ${definition.allowedEntityTypes.join(", ")}. Include traceable relation updates.`;
}

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

  if (definition.agentType === "executor-market-research") {
    return [
      "Use verifiable sources or explicitly record a research gap.",
      "Link Evidence to concrete Requirements or decision candidates.",
      "Do not present model memory as verified fact.",
      "Preserve source traceability.",
    ];
  }
  if (definition.agentType === "executor-product-execution") {
    return [
      "Keep the breakdown to the minimum viable product scope.",
      "Link each essential Component to a selected Feature.",
      "Add traceable acceptance Requirements or Metrics.",
      "Avoid speculative architecture and count-filler Components.",
    ];
  }

  return [
    `Use only allowed entity types: ${definition.allowedEntityTypes.join(", ")}.`,
    "Keep unresolved gaps as assumptions, risks, or open questions, not confirmed Decisions.",
    "Use approved explicit relation directions.",
    "Preserve traceability and avoid duplicate count-filler entities.",
  ];
}

function isSupplementPlanInput(input: PlannerAgentInput): boolean {
  return (
    Boolean(input.supplementAgentTypes?.length) ||
    input.userInput.some((item) =>
      /\[form answers - [^\]]+\]/i.test(item.content),
    )
  );
}

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

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function createTaskId(sequence: number): string {
  return `task-${String(sequence).padStart(2, "0")}`;
}

function summarizeBusinessModels(items: BusinessModelItem[]): string {
  if (items.length === 0) {
    return "No business model item was identified by Request Agent.";
  }
  return items.map((item) => item.user_goal).join("; ");
}

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

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

/**
 * 格式化 TaskExecutionPlan 为 tagged block，供 SSE 传输和前端展示。
 */
export function formatTaskExecutionPlanBlock(plan: TaskExecutionPlan): string {
  return `<task-execution>\n${JSON.stringify(plan, null, 2)}\n</task-execution>`;
}
