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
      maxTokens: 9216,
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
      createFallbackWorkflowResult(input.plan, input.executorResults, input.userInput),
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
  const taskSpecs = selectedDefinitions.map((definition, index) => ({
    definition,
    sequence: index + 1,
    taskId: createTaskId(index + 1),
  }));
  const taskIdByAgent = new Map(
    taskSpecs.map(({ definition, taskId }) => [definition.agentType, taskId]),
  );

  const plan: TaskExecutionPlan = {
    status: isSupplementPlanInput(input.userInput) ? "supplement" : "initial",
    request_summary: summarizeBusinessModels(analysis.business_model),
    dag: {
      nodes: taskSpecs.map(({ taskId }) => taskId),
      edges: taskSpecs.flatMap(({ definition, taskId }) =>
        getFallbackDependencyAgents(definition.agentType, selectedAgents)
          .flatMap((agentType) => {
            const source = taskIdByAgent.get(agentType);
            return source ? [{ source, target: taskId }] : [];
          }),
      ),
    },
    tasks: taskSpecs.map(({ definition, sequence, taskId }) => ({
      task_id: taskId,
      sequence,
      title: createFallbackTaskTitle(definition.agentType),
      description: createFallbackTaskDescription(definition, analysis),
      assigned_agent: definition.agentType,
      depends_on: getFallbackDependencyAgents(
        definition.agentType,
        selectedAgents,
      ).flatMap((agentType) => {
        const dependencyTaskId = taskIdByAgent.get(agentType);
        return dependencyTaskId ? [dependencyTaskId] : [];
      }),
      covered_business_model_indexes: [...coveredIndexes],
      expected_output: createFallbackExpectedOutput(definition),
      quality_check: {
        status: "pending",
        criteria: createFallbackQualityCriteria(definition),
      },
    })),
    assumptions: [
      FALLBACK_PLAN_ASSUMPTION,
      `Fallback reason: ${reason}.`,
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
    "architecture",
    "real-time",
    "realtime",
    "sync",
    "websocket",
    "crdt",
    "ot",
    "multi-user",
    "collaboration",
    "browser",
    "web",
    "技术",
    "架构",
    "模型",
    "智能体",
    "工程",
    "实时",
    "同步",
    "多人",
    "协同",
    "浏览器",
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
    "editor",
    "document",
    "browser",
    "web",
    "collaboration",
    "toolbar",
    "sharing",
    "界面",
    "交互",
    "原型",
    "页面",
    "编辑器",
    "文档",
    "浏览器",
    "协同",
    "工具栏",
    "分享",
  ]);

  if (
    matchesAny(requestText, ["full chain", "end-to-end", "全链路", "完整方案"])
  ) {
    EXECUTOR_DEFINITIONS.forEach((definition) =>
      selected.add(definition.agentType),
    );
  }

  return FALLBACK_EXECUTOR_ORDER.flatMap((agentType) => {
    const definition = EXECUTOR_DEFINITIONS.find(
      (item) => item.agentType === agentType,
    );
    return definition && selected.has(definition.agentType) ? [definition] : [];
  });
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
 * 为 fallback DAG 生成真实图谱数据依赖。
 */
function getFallbackDependencyAgents(
  agentType: ExecutorAgentType,
  selectedAgents: Set<ExecutorAgentType>,
): ExecutorAgentType[] {
  switch (agentType) {
    case "executor-product-strategy":
    case "executor-toolkit":
      return [];
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
function createFallbackTaskTitle(agentType: ExecutorAgentType): string {
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
): string {
  const requestContext = [
    `Request goal: ${summarizeBusinessModels(analysis.business_model)}`,
    `Explicit constraints: ${summarizeBusinessConstraints(analysis.business_model)}`,
    `Known uncertainty: ${summarizeMissingInformation(analysis.business_model)}`,
  ].join("\n");

  switch (definition.agentType) {
    case "executor-product-strategy":
      return `${requestContext}\nCreate foundational Goal, Requirement, and user-stated Evidence entities. Create confirmed Decision entities only for choices explicitly stated by the user or already supported by product_context/current graph evidence. Treat missing information as assumptions, risks, open questions, or clearly labeled decision candidates; do not convert unknown scale, authentication, technical architecture, or similar gaps into confirmed Decisions. Use explicit relation directions such as Goal --Drives--> Decision candidate and Decision --Produces--> Requirement only when the Decision is actually supported.`;
    case "executor-market-research":
      return `${requestContext}\nUse upstream strategy entities to add market or competitor Evidence, benchmark Requirements, and Metrics only when verifiable sources are available. If no verified source/tool-backed evidence is available, create Custom research-gap entities or unvalidated Evidence with that limitation stated clearly. Link Evidence with explicit directions such as Evidence --Validates--> Requirement or supported Decision candidate. Do not present model memory as verified market fact.`;
    case "executor-gtm":
      return `${requestContext}\nUse upstream strategy entities to add GTM Requirements, Metrics, Evidence, and decision candidates when launch, adoption, pricing, or channel implications are relevant. Create confirmed GTM Decisions only when user input, existing graph context, or verified Evidence supports them.`;
    case "executor-product-discovery":
      return `${requestContext}\nTranslate strategy requirements into testable Feature hypotheses, user-stated Evidence, and Metrics. Mark inferred features as hypotheses rather than validated facts, and explicitly cover high-impact missing information by creating validation paths or user-facing open questions. Use Feature --Satisfies--> Requirement and Metric --Measures--> Feature or Requirement.`;
    case "executor-product-execution":
      return `${requestContext}\nBreak discovered Feature hypotheses into sub-features and Component entities only where the feature is semantically distinct. Add implementation hierarchy relations and component-level Requirements or Metrics needed by later technical and interface tasks. Use Component --Implements--> Feature and avoid duplicate Components created only to satisfy counts.`;
    case "executor-marketing-growth":
      return `${requestContext}\nDefine growth-oriented Metrics, Requirements, and decision candidates only where the request implies adoption, activation, retention, or marketing measurement. Preserve traceability to strategy or GTM nodes and avoid confirmed Decisions without supporting Evidence.`;
    case "executor-data-analytics":
      return `${requestContext}\nDefine quantitative Metrics, measurement plans, instrumentation Components, and benchmark gaps that can later validate product decisions or feature success. Because this is a greenfield workflow unless the graph contains real data, do not claim measured results or industry benchmarks without verifiable Evidence. Link Metric --Measures--> Feature or Requirement.`;
    case "executor-ai-shipping":
      return `${requestContext}\nReview implementation Components and compare technical options, constraints, Evidence, and delivery risks. Do not lock options such as CRDT vs OT, Yjs vs Automerge, SAML vs OIDC vs LDAP, or storage architecture unless the user or prior graph explicitly chose them. Capture trade-offs as Evidence, risks, open questions, or decision candidates, then link Evidence --Validates--> a supported Decision candidate when appropriate.`;
    case "executor-toolkit":
      return `${requestContext}\nCreate Custom scope, assumptions, compliance, and operational guardrail artifacts. Add a small number of Component constraint nodes for cross-cutting non-functional expectations such as security, privacy, workflow, or browser support. If this task runs before Strategy outputs exist, do not create relations to nonexistent Goal, Requirement, or Component IDs; record intended References/Constrains targets in descriptions for later linking.`;
    case "executor-interface-craft":
      return `${requestContext}\nReview UI-facing Components and add craft constraints plus Evidence for UX risks or anti-patterns. Focus on accessibility, responsive behavior, interaction states, and collaboration/editor usability when relevant. Use Component constraint --Constrains--> UI Component and Evidence --Validates--> Requirement or Component when evidence is available.`;
    default:
      return `${requestContext}\nCreate graph-native updates within this executor's allowed entity and relation boundaries.`;
  }
}

/**
 * 生成 fallback 任务的预期产出说明。
 */
function createFallbackExpectedOutput(
  definition: ExecutorAgentDefinition,
): string {
  return `Produce graph-native updates using allowed entity types only: ${definition.allowedEntityTypes.join(
    ", ",
  )}. Every new or changed entity should have traceable relations to the request goal, upstream graph nodes, or covered business model indexes.`;
}

/**
 * 生成 fallback 任务的验收标准。
 */
function createFallbackQualityCriteria(
  definition: ExecutorAgentDefinition,
): string[] {
  return [
    `Use only allowed entity types for ${definition.agentType}: ${definition.allowedEntityTypes.join(", ")}.`,
    "Do not create agent-name placeholder tasks or orphan graph entities.",
    "Preserve traceability from covered business model indexes to entities, relations, decisions, risks, or open questions.",
    "Record unresolved subjective gaps as assumptions, risks, or open questions instead of silently deciding them.",
    "Do not convert missing information or unverified assumptions into confirmed Decision entities.",
    "Use explicit relation directions, for example Feature --Satisfies--> Requirement and Component --Implements--> Feature.",
    "Prefer semantic coverage over fixed entity counts; do not create duplicate entities just to satisfy a number.",
  ];
}

/**
 * 判断 fallback 计划是否来自用户确认/补充表单。
 */
function isSupplementPlanInput(userInput: PlannerAgentInput["userInput"]): boolean {
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
    status: proposalQuestions.length > 0 ? "pending_user_confirmation" : "completed",
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
 * 生成业务约束摘要，供 fallback Executor 任务自包含描述使用。
 */
function summarizeBusinessConstraints(items: BusinessModelItem[]): string {
  const constraints = items.flatMap((item) => item.goal_constraints);
  return constraints.length > 0 ? constraints.join("; ") : "None provided.";
}

/**
 * 生成缺失信息摘要，提醒 fallback Executor 不要静默假设关键事实。
 */
function summarizeMissingInformation(items: BusinessModelItem[]): string {
  const missingInformation = items.flatMap((item) =>
    item.missing_information.map(
      (info) => `${info.index}. ${info.description} (importance ${info.importance})`,
    ),
  );

  return missingInformation.length > 0
    ? missingInformation.join("; ")
    : "None provided.";
}
